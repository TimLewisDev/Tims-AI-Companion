using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Drawing = System.Drawing;
using Forms = System.Windows.Forms;

namespace TtCompanion
{
    // Tatty's tray app. Reads the window server's server.json (port and token),
    // watches its events, and pops Tatty and the speech bubble up over everything
    // when a question or a reply arrives; tucks them away once nothing waits.
    // Exits when the server stops.
    public partial class App : Application
    {
        private Mutex? single;
        private EventWaitHandle? wake;
        private TattyWindow tatty = null!;
        private BubbleWindow bubble = null!;
        private Effects effects = null!;
        private TaskbarProxy proxy = null!;
        private Forms.NotifyIcon tray = null!;
        private Forms.ContextMenuStrip menu = null!;
        private HttpClient http = null!;
        private readonly Sounds sounds = new Sounds();
        private Settings settings = new Settings();
        private readonly DispatcherTimer poll = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        private readonly DispatcherTimer tuck = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
        private readonly HashSet<string> openAsks = new HashSet<string>();
        private string home = "";
        private (int Port, string Token) server;
        private int since = -1;
        private int failures;
        private bool polling;
        private bool tattyPlaced;
        private bool demoPulse; // the pulses, asked for from his menu rather than by a question
        private bool alertWaiting; // something called for the person that they have not opened yet

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            if (Array.IndexOf(e.Args, "--pick-folder") >= 0) { PickFolderAndExit(e.Args); return; }
            if (Array.IndexOf(e.Args, "--pick-file") >= 0) { PickFileAndExit(e.Args); return; }
            single = new Mutex(true, @"Local\tatty-companion", out bool first);
            if (!first) { Shutdown(0); return; }

            // Before any window and before the tray: the exe lives in a folder
            // named after the plugin's version, so without a name of our own the
            // shell would call this a different application after every update
            // and lose the taskbar button's place and history with it.
            Native.NameThisApp("TimsAICompanion.Tatty");

            home = Arg(e.Args, "--home") ?? DefaultHome();
            var info = ReadServer(home);
            if (info == null) { Shutdown(1); return; }
            Connect(info.Value);

            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tatty", "webview2");
            var face = MakeIcon(); // the one icon, before anything asks for it
            settings = Settings.Load();
            sounds.Enabled = settings.Sound;
            Motion.Chosen = settings.Lively;
            tatty = new TattyWindow();
            bubble = new BubbleWindow(PageUrl(info.Value), dataDir);
            // The confetti, the pulses and the Z's: a click-through window of its
            // own around Tatty, so it can cover more ground than he does without
            // taking any of the desktop out of use.
            effects = new Effects { Enabled = settings.Effects };
            // Z's only while there is a Tatty to see them over: he keeps dozing
            // off while tucked away, which is nobody's business but his.
            tatty.PoseChanged += pose => effects.Sleeping(pose == Pose.Asleep && tatty.IsVisible);
            // The same face in the taskbar, in Alt-Tab and in the tray.
            tatty.Icon = bubble.Icon = WindowIcon();
            // The button that is always there, whether or not anything is on screen.
            proxy = new TaskbarProxy(WindowIcon());
            proxy.Chosen += OnProxyChosen;
            proxy.Dismissed += HideEverything;
            bubble.PanelOwnsButton += panelHasOne => { if (panelHasOne) proxy.HideButton(); else proxy.ShowAsButton(); };
            proxy.ShowAsButton();
            tatty.Clicked += ToggleBubble;
            tatty.Moved += () =>
            {
                tattyPlaced = true;
                effects.PlaceOn(tatty);
                if (bubble.IsShown && !bubble.IsExpanded) PlaceBubble();
            };
            bubble.PageMessage += OnPageMessage;
            // A collapse lands a frame later; the full panel places itself.
            bubble.SizeChanged += (_, _) => { if (bubble.IsShown && !bubble.IsExpanded) PlaceBubbleOnce(); };
            // Up from the taskbar: Tatty comes back with it, wherever it landed.
            bubble.Restored += () => { tuck.Stop(); PopUp(activate: false); };
            // Down into the taskbar: remember where the panel was while we can.
            bubble.WentToTaskbar += () => { tuck.Stop(); bubble.SaveBounds(); };
            bubble.Woken += () => tuck.Stop();
            bubble.AskedToClose += HideEverything;
            tuck.Tick += (_, _) => TryTuck();

            Native.OnForegroundChanged(OnForegroundChanged);

            // One menu, in both the places a person reaches for it.
            menu = MakeMenu();
            tatty.RightClicked += ShowMenu;
            tray = MakeTray(face);
            PopUp(activate: false);
            WatchForWake();
            poll.Tick += async (_, _) => await Poll();
            poll.Start();
        }

        protected override void OnExit(ExitEventArgs e)
        {
            bubble?.SaveBounds();
            Native.StopForegroundHook();
            if (tray != null) { tray.Visible = false; tray.Icon?.Dispose(); tray.Dispose(); }
            wake?.Dispose();
            single?.Dispose();
            base.OnExit(e);
        }

        // ------------------------------------------------------------ server

        private static string? Arg(string[] args, string name)
        {
            int i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        private static string DefaultHome()
        {
            var own = Environment.GetEnvironmentVariable("TATTY_HOME");
            if (!string.IsNullOrEmpty(own)) return own;
            var config = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
            if (!string.IsNullOrEmpty(config)) return Path.Combine(config, "tatty");
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude", "tatty");
        }

        private static (int, string)? ReadServer(string home)
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(home, "server.json")));
                return (doc.RootElement.GetProperty("port").GetInt32(), doc.RootElement.GetProperty("token").GetString() ?? "");
            }
            catch (Exception) { return null; }
        }

        private void Connect((int Port, string Token) info)
        {
            server = info;
            http?.Dispose();
            http = new HttpClient { BaseAddress = new Uri($"http://127.0.0.1:{info.Port}"), Timeout = TimeSpan.FromSeconds(10) };
            http.DefaultRequestHeaders.Add("X-TT-Token", info.Token);
            since = -1;
            failures = 0;
            openAsks.Clear();
        }

        private static string PageUrl((int Port, string Token) info) =>
            $"http://127.0.0.1:{info.Port}/?mode=companion#token={info.Token}";

        // The window was closed and opened again: follow it to the new server
        // instead of leaving, so close-then-open just works.
        private bool FollowNewServer()
        {
            var info = ReadServer(home);
            if (info == null || info.Value == server) return false;
            Connect(info.Value);
            bubble.Navigate(PageUrl(info.Value));
            return true;
        }

        private async Task Poll()
        {
            if (polling) return;
            polling = true;
            try
            {
                var text = await http.GetStringAsync($"/api/events?since={Math.Max(since, 0)}");
                failures = 0;
                using var doc = JsonDocument.Parse(text);
                var events = doc.RootElement;
                bool first = since < 0;
                bool question = false, anything = false;
                string? finished = null; // the loudest milestone in this batch
                foreach (var ev in events.EnumerateArray())
                {
                    since = ev.GetProperty("seq").GetInt32();
                    anything = true;
                    string type = ev.GetProperty("type").GetString() ?? "";
                    if (type == "ask") { openAsks.Add(ev.GetProperty("id").GetString() ?? ""); question = true; }
                    else if (type == "answered") openAsks.Remove(ev.GetProperty("id").GetString() ?? "");
                    else if (type == "milestone") finished = Louder(finished, Tier(ev));
                }
                // The first poll is the backlog, not the news: it says what is
                // still waiting and nothing else, or a window opened beside a
                // day's work would arrive mid-party.
                if (first) { since = Math.Max(since, 0); question = openAsks.Count > 0; finished = null; anything = false; }
                if (anything) tatty.Poke();
                if (question || finished != null) alertWaiting = true;
                tatty.HasBadge = openAsks.Count > 0;
                if (question || finished != null) PopUp(activate: false);
                if (finished != null) Celebrate(finished == "big");
                else if (question) Asked();
                effects.Asking(Waiting);
                if (openAsks.Count == 0 && bubble.IsShown && !tuck.IsEnabled) tuck.Start();
                if (openAsks.Count > 0) tuck.Stop();
            }
            catch (Exception)
            {
                if (FollowNewServer()) return;
                if (++failures >= 3)
                {
                    poll.Stop();
                    tray.ShowBalloonTip(3000, "Tatty", "Tatty's window closed. /tatty open brings me back.", Forms.ToolTipIcon.Info);
                    await Task.Delay(3500);
                    Quit();
                }
            }
            finally { polling = false; }
        }

        // Whether the rings should be pulsing: because something is waiting for an
        // answer, or because his menu was asked for them.
        private bool Waiting => openAsks.Count > 0 || demoPulse;

        private static string Tier(JsonElement ev) =>
            ev.TryGetProperty("tier", out var tier) ? tier.GetString() ?? "small" : "small";

        // Of two milestones in the same breath, the one worth the bigger fuss.
        private static string Louder(string? had, string tier) =>
            had == "big" || tier == "big" ? "big" : had ?? tier;

        // A section is finished: he jumps and wiggles, the confetti goes up, and
        // there is a flourish to hear. "big" is a plan signed off or a build
        // complete; everything else is the smaller version of all three.
        private void Celebrate(bool big)
        {
            tatty.Celebrate(big);
            effects.Confetti(big);
            sounds.Play(big ? Sounds.Cue.Complete : Sounds.Cue.Milestone);
        }

        // A question has arrived: a sharp double hop and a chime. The ring pulses
        // that go on until it is answered are started from the poll, which knows
        // how many are still open.
        private void Asked()
        {
            tatty.Alert();
            sounds.Play(Sounds.Cue.Question);
        }

        private async Task StopServer()
        {
            try { await http.PostAsync("/api/stop", new StringContent("{}", Encoding.UTF8, "application/json")); } catch (Exception) { }
            Quit();
        }

        // The Desktop shortcut and a taskbar pin start Tatty by running `tatty.sh
        // boot`, which finds this app already running and rings this event instead
        // of starting a second one (server.py's wake_companion).
        private void WatchForWake()
        {
            wake = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\tatty-companion-show");
            var handle = wake;
            new Thread(() =>
            {
                try { while (handle.WaitOne()) Dispatcher.BeginInvoke(new Action(() => PopUp(activate: true))); }
                catch (ObjectDisposedException) { }
            }) { IsBackground = true }.Start();
        }

        // Leaving for good. Tatty's windows refuse to be closed, because closing
        // one is how a person says "put it away", so they are told to stop first:
        // a refusal here would cancel the shutdown and leave the process running
        // with nothing to show for itself.
        private void Quit(int code = 0)
        {
            BubbleWindow.Quitting = true;
            Shutdown(code);
        }

        // ------------------------------------------------------------ choosing a folder

        private static Microsoft.Win32.OpenFolderDialog FolderDialog(string? start, string? title = null)
        {
            var dlg = new Microsoft.Win32.OpenFolderDialog { Title = string.IsNullOrEmpty(title) ? "Choose Tatty's root folder" : title };
            try
            {
                if (!string.IsNullOrEmpty(start) && Directory.Exists(start)) dlg.InitialDirectory = Path.GetFullPath(start);
            }
            catch (Exception) { }
            return dlg;
        }

        // The page asked (or the tray did): Windows' own folder dialog, in front
        // of the bubble; the choice goes back to the page, which sets the root.
        private void PickRoot(string? start) => PickFolder(start, null);

        // Any folder the page needs (the root, a feature's project): the arg of
        // "pick-folder" is {"title", "start"}. "picked:" (empty when cancelled) answers.
        private void PickFolder(string? start, string? title)
        {
            tuck.Stop();
            var dlg = FolderDialog(start, title);
            bubble.Post("picked:" + (dlg.ShowDialog(bubble) == true ? dlg.FolderName : ""));
        }

        private void PickFolderFromPage(string? arg)
        {
            var (start, title) = PickArgs(arg);
            PickFolder(start, title);
        }

        private static (string? Start, string? Title) PickArgs(string? arg)
        {
            string? start = null, title = null;
            try
            {
                using var doc = JsonDocument.Parse(arg ?? "{}");
                if (doc.RootElement.TryGetProperty("start", out var s)) start = s.GetString();
                if (doc.RootElement.TryGetProperty("title", out var t)) title = t.GetString();
            }
            catch (JsonException) { }
            return (start, title);
        }

        // A markdown document the page needs (a design document for the User
        // Stories board): Windows' own file dialog, answered like a folder with
        // "picked:" (empty when cancelled). The start may be a folder or a file in it.
        private static Microsoft.Win32.OpenFileDialog FileDialog(string? start, string? title)
        {
            var dlg = new Microsoft.Win32.OpenFileDialog
            {
                Title = string.IsNullOrEmpty(title) ? "Choose a document" : title,
                Filter = "Markdown documents (*.md)|*.md|All files (*.*)|*.*",
                CheckFileExists = true,
            };
            try
            {
                string? dir = !string.IsNullOrEmpty(start) && File.Exists(start) ? Path.GetDirectoryName(start) : start;
                if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) dlg.InitialDirectory = Path.GetFullPath(dir);
            }
            catch (Exception) { }
            return dlg;
        }

        private void PickFileFromPage(string? arg)
        {
            tuck.Stop();
            var (start, title) = PickArgs(arg);
            var dlg = FileDialog(start, title);
            bubble.Post("picked:" + (dlg.ShowDialog(bubble) == true ? dlg.FileName : ""));
        }

        // TtCompanion.exe --pick-file [--start <dir>] [--out <file>] [--title <t>]:
        // the file dialog alone, for the window server when the page is in a
        // browser; the same as --pick-folder otherwise.
        private void PickFileAndExit(string[] args)
        {
            var owner = new Window
            {
                Width = 1, Height = 1, Left = -32000, Top = -32000, WindowStyle = WindowStyle.None,
                ShowInTaskbar = false, Topmost = true, AllowsTransparency = true,
                Background = System.Windows.Media.Brushes.Transparent,
            };
            owner.Show();
            owner.Activate();
            var dlg = FileDialog(Arg(args, "--start"), Arg(args, "--title"));
            bool chosen = dlg.ShowDialog(owner) == true;
            string? outFile = Arg(args, "--out");
            try
            {
                if (outFile != null) File.WriteAllText(outFile, chosen ? dlg.FileName : "");
            }
            catch (Exception) { }
            owner.Close();
            Shutdown(chosen ? 0 : 1);
        }

        // TtCompanion.exe --pick-folder [--start <dir>] [--out <file>]: just the
        // dialog, for the window server when the page is in a browser. Writes the
        // chosen folder (empty when cancelled) to --out. An invisible topmost
        // owner brings the dialog to the front even though another app has the focus.
        private void PickFolderAndExit(string[] args)
        {
            var owner = new Window
            {
                Width = 1, Height = 1, Left = -32000, Top = -32000, WindowStyle = WindowStyle.None,
                ShowInTaskbar = false, Topmost = true, AllowsTransparency = true,
                Background = System.Windows.Media.Brushes.Transparent,
            };
            owner.Show();
            owner.Activate();
            var dlg = FolderDialog(Arg(args, "--start"), Arg(args, "--title"));
            bool chosen = dlg.ShowDialog(owner) == true;
            string? outFile = Arg(args, "--out");
            try
            {
                if (outFile != null) File.WriteAllText(outFile, chosen ? dlg.FolderName : "");
            }
            catch (Exception) { }
            owner.Close();
            Shutdown(chosen ? 0 : 1);
        }

        // ------------------------------------------------------------ showing

        // Up in the corner, above everything, without taking the keyboard
        // (unless the person asked, from the tray).
        private void PopUp(bool activate)
        {
            tuck.Stop();
            if (!tatty.IsVisible) tatty.Show();
            if (!tattyPlaced) PlaceTatty();
            if (!bubble.IsVisible) bubble.Show();
            if (Native.IsMinimised(bubble)) bubble.Restore();
            if (!bubble.IsExpanded) PlaceBubble();
            tatty.Poke(); // being brought out is something happening: wake up
            tatty.Hop();
            bubble.Post("shown");
            if (activate) bubble.Activate();
        }

        // A click on Tatty. The full panel can sit behind other windows, so for it
        // the click first brings it to the front, and hides it only when it already is.
        private void ToggleBubble()
        {
            if (alertWaiting) { OpenAlert(); return; }
            if (Native.IsMinimised(bubble)) { bubble.Restore(); return; }
            if (bubble.IsShown && bubble.IsExpanded && !bubble.IsActive) { Native.BringToFront(bubble); return; }
            if (bubble.IsShown) { TuckAway(); return; }
            PopUp(activate: false);
        }

        // A click on Tatty while something is calling: not "away with the bubble"
        // but the full panel, on the page it is about -- which the page knows, and
        // is told to go to once the window is big enough to show it.
        private void OpenAlert()
        {
            alertWaiting = false;
            PopUp(activate: false);
            if (bubble.IsExpanded) Native.BringToFront(bubble); else bubble.SetExpanded(true);
            bubble.Activate();
            bubble.Post("open-alert");
        }

        // The taskbar button is always a way back to Tatty, never a way to put him
        // away: the x and the tray do that. A click that arrives while he is
        // already in front just gives him the focus, which is what it looked like
        // it would do anyway.
        private void OnProxyChosen()
        {
            if (Native.IsMinimised(bubble)) { bubble.Restore(); return; }
            if (!bubble.IsShown) { PopUp(activate: true); return; }
            Native.BringToFront(bubble);
        }

        // Out of sight until something happens. The bubble goes, and so does
        // Tatty -- unless the person has asked to keep him on the desktop, in
        // which case he stays out there on his own and gets on with his day
        // (Avatar.cs: that is when the fidgeting, the sitting and the sleeping
        // are there to be seen). The taskbar button stays either way, which is
        // the whole reason the proxy window exists.
        private void TuckAway() => Tuck(keepTatty: settings.StayVisible);

        // The x, the tray's "hide" and the taskbar's close are a person saying
        // "away with all of it", which outranks the setting.
        private void HideEverything() => Tuck(keepTatty: false);

        private void Tuck(bool keepTatty)
        {
            bubble.Hide();
            if (keepTatty) return;
            tatty.Hide();
            effects.Clear();
            tattyPlaced = false;
        }

        // Another window came to the front. Tatty and the compact bubble are meant
        // to be seen, so they say "on top" again -- being topmost is only a
        // promise about the windows that were there first, and the next one to
        // declare itself topmost would otherwise sit over him.
        //
        // Never over the shell (Show desktop, the Start menu, the taskbar), never
        // over a window that has a whole monitor to itself (a game, a video, an
        // editor in full screen), and never while the full panel is out, because
        // then Tatty is an ordinary window taking his turn like the rest.
        private void OnForegroundChanged(IntPtr hwnd)
        {
            if (Native.IsOurs(hwnd) || Native.IsShellOrDesktop(hwnd) || Native.CoversItsMonitor(hwnd)) return;
            if (tatty.IsVisible) Native.KeepOnTop(tatty, true);
            if (bubble.IsShown && !bubble.IsExpanded) Native.KeepOnTop(bubble, true);
            if (effects.IsVisible) Native.KeepOnTop(effects, true); // after Tatty: the confetti is in front of him
        }

        private void TryTuck()
        {
            // Not while there's something to answer, the person is in it, it's the
            // full panel, or it's already down in the taskbar.
            if (openAsks.Count > 0 || bubble.IsExpanded || bubble.IsActive || bubble.IsMouseOver
                || tatty.IsMouseOver || Native.IsMinimised(bubble)) return;
            tuck.Stop();
            TuckAway();
        }

        private void OnPageMessage(string type) => OnPageMessage(type, null);

        private void OnPageMessage(string type, string? arg)
        {
            switch (type)
            {
                case "pick-root": PickRoot(arg); break;
                case "pick-folder": PickFolderFromPage(arg); break;
                case "pick-file": PickFileFromPage(arg); break;
                // The page is about to have the server open a new session's
                // window: let that window come to the front (Tatty has the focus now).
                case "allow-foreground": Native.AllowAnyForeground(); break;
                case "expand": bubble.SetExpanded(true); bubble.Activate(); break;
                // The person opened or dismissed what was calling, in the page itself.
                case "alert-cleared": alertWaiting = false; break;
                case "collapse": bubble.SetExpanded(false); PlaceBubble(); break;
                case "drag": bubble.Drag(); break;
                case "maximise": bubble.ToggleMaximise(); break;
                case "minimise": bubble.Minimise(); break;
                case "hide": HideEverything(); break;
                // The mode on the page (engineering, design, production): Tatty
                // himself is drawn in its colour too.
                case "mode": SetAccent(arg); break;
            }
        }

        // TtAccent is what TattyWindow.xaml draws him with (App.xaml): swapping
        // the brush redraws him, because every use is a DynamicResource.
        private void SetAccent(string? mode)
        {
            var key = string.IsNullOrEmpty(mode) ? "TtAccentEngineering"
                : "TtAccent" + char.ToUpperInvariant(mode[0]) + mode.Substring(1);
            if (Resources[key] is Brush brush) Resources["TtAccent"] = brush;
        }

        private void PlaceTatty()
        {
            var wa = Native.WorkAreaUnderPointer();
            var r = Native.Rect(tatty);
            Native.MoveTo(tatty, wa.Right - r.Width - 24, wa.Bottom - r.Height - 8);
            effects.PlaceOn(tatty); // the stage goes wherever he does
        }

        // The compact bubble beside Tatty (above him, or to his left if there's no
        // room). Twice: moving to another monitor can change the DPI, and with it
        // the size. The full panel is where the person put it (BubbleWindow).
        private void PlaceBubble()
        {
            PlaceBubbleOnce();
            Dispatcher.BeginInvoke(DispatcherPriority.Background, new Action(PlaceBubbleOnce));
        }

        private void PlaceBubbleOnce()
        {
            if (bubble.IsExpanded) return;
            var wa = Native.WorkAreaOf(tatty);
            var t = Native.Rect(tatty);
            var b = Native.Rect(bubble);
            // Off Tatty himself, not off his window: it keeps empty strips above
            // and below him to jump and sit in (TattyWindow's insets), and a
            // bubble floating over one of them would just look misplaced.
            double s = Native.Scale(tatty);
            int top = t.Top + (int)(TattyWindow.TopInset * s), bottom = t.Bottom - (int)(TattyWindow.BottomInset * s);
            int x = t.Right - b.Width, y = top - b.Height - 6;
            if (y < wa.Top) { x = t.Left - b.Width - 6; y = bottom - b.Height; }
            x = Math.Clamp(x, wa.Left, Math.Max(wa.Left, wa.Right - b.Width));
            y = Math.Clamp(y, wa.Top, Math.Max(wa.Top, wa.Bottom - b.Height));
            Native.MoveTo(bubble, x, y);
        }

        // ------------------------------------------------------------ his menu

        // A menu item that is on or off and remembers which, saved as soon as it
        // is clicked so a crash can't lose the choice. `telling` is on while the
        // menu is being brought up to date, because setting Checked raises the
        // same event a click does -- and opening a menu must not be mistaken for
        // choosing something in it.
        private bool telling;

        private Forms.ToolStripMenuItem Choice(string text, Func<bool> on, Action<bool> set)
        {
            var item = new Forms.ToolStripMenuItem(text) { Checked = on(), CheckOnClick = true };
            item.CheckedChanged += (_, _) => { if (telling) return; set(item.Checked); settings.Save(); };
            freshen += () => item.Checked = on();
            return item;
        }

        // What each choice in the menu should say by the time it is seen.
        private Action? freshen;

        // Tatty's menu, which the tray icon and a right-click on Tatty himself
        // both show: the same menu in both places, built once.
        private Forms.ContextMenuStrip MakeMenu()
        {
            var menu = new Forms.ContextMenuStrip();
            menu.Opening += (_, _) =>
            {
                telling = true;
                freshen?.Invoke();
                telling = false;
            };
            menu.Items.Add("Show Tatty", null, (_, _) => PopUp(activate: true));
            menu.Items.Add("Open full panel", null, (_, _) => { PopUp(activate: true); if (!bubble.IsExpanded) OnPageMessage("expand"); });
            menu.Items.Add("Change root folder…", null, (_, _) =>
            {
                PopUp(activate: true);
                if (!bubble.IsExpanded) OnPageMessage("expand");
                PickRoot(null);
            });
            menu.Items.Add("Hide until something happens", null, (_, _) => OnPageMessage("hide"));
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add(PreviewMenu());
            menu.Items.Add(new Forms.ToolStripSeparator());
            // What Tatty is like to have around: whether he moves, whether he
            // makes a noise, whether he throws confetti, and whether he goes away
            // when there is nothing on. Animations starts as the OS's own answer
            // and is the person's for good as soon as they click it (Motion).
            menu.Items.Add(Choice("Animations", () => Motion.On, on =>
            {
                settings.Lively = on;
                Motion.Chosen = on;
                if (on) tatty.Hop();
            }));
            menu.Items.Add(Choice("Sound", () => settings.Sound, on =>
            {
                settings.Sound = sounds.Enabled = on;
                if (on) sounds.Preview(Sounds.Cue.Blip); // so the choice is audible
            }));
            menu.Items.Add(Choice("Effects", () => settings.Effects, on => settings.Effects = effects.Enabled = on));
            menu.Items.Add(Choice("Keep Tatty on the desktop", () => settings.StayVisible, on =>
            {
                settings.StayVisible = on;
                if (!on || tatty.IsVisible) return;
                tatty.Show();
                PlaceTatty();
            }));
            menu.Items.Add(new Forms.ToolStripSeparator());
            menu.Items.Add("Close Tatty's window", null, async (_, _) => await StopServer());
            menu.Items.Add("Quit Tatty", null, (_, _) => Quit());
            return menu;
        }

        // Right-clicked: his menu where the pointer is. Tatty himself never takes
        // the keyboard, but a menu must, or it could not be used -- which is the
        // same bargain the tray icon's makes.
        private void ShowMenu()
        {
            var at = Native.Pointer();
            menu.Show(at.X, at.Y);
        }

        private Forms.NotifyIcon MakeTray(Drawing.Icon face)
        {
            var icon = new Forms.NotifyIcon { Icon = face, Text = "Tatty", ContextMenuStrip = menu, Visible = true };
            icon.MouseClick += (_, e) => { if (e.Button == Forms.MouseButtons.Left) ToggleBubble(); };
            return icon;
        }

        // ------------------------------------------------------------ previews

        // Everything Tatty can do, by name, to be watched on purpose: the
        // performances, the poses he holds, what the stage throws about him, the
        // noises, and the two whole reactions as they really happen. This is the
        // catalogue of his repertoire -- a new trick belongs here as well, or
        // nobody will know he has it.
        //
        // A preview cuts in and winds back the clock that decides when he
        // fidgets, so what was picked is what is seen (Avatar.Preview).
        private Forms.ToolStripMenuItem PreviewMenu()
        {
            var preview = new Forms.ToolStripMenuItem("Preview");
            var items = preview.DropDownItems;
            var noises = new List<Forms.ToolStripItem>();

            void Does(string what, Act act) => items.Add(what, null, (_, _) => tatty.Preview(act));
            void Holds(string what, Pose pose) => items.Add(what, null, (_, _) => tatty.Preview(pose));
            void Hears(string what, Sounds.Cue cue) => noises.Add(items.Add(what, null, (_, _) => sounds.Preview(cue)));
            void Line() => items.Add(new Forms.ToolStripSeparator());

            Does("Hop", Act.Hop);
            Does("Wake with a start", Act.Startle);
            Does("Alert: a question waiting", Act.Alert);
            Does("Dance, foot to foot", Act.Dance);
            Does("Stretch", Act.Stretch);
            Does("Look about", Act.LookAround);
            Does("Yawn", Act.Yawn);
            Does("Celebrate", Act.Celebrate);
            Does("Celebrate, the big one", Act.CelebrateBig);
            Line();
            Holds("Stand up", Pose.Stand);
            Holds("Sit down", Pose.Sit);
            Holds("Doze", Pose.Doze);
            Holds("Fall asleep (Z's and all)", Pose.Asleep);
            Line();
            items.Add("Confetti", null, (_, _) => effects.Confetti(big: false));
            items.Add("Confetti, the big one", null, (_, _) => effects.Confetti(big: true));
            // The pulses are a state and not a one-off: the poll would put them
            // out again a second later if it didn't know they were wanted.
            var pulse = new Forms.ToolStripMenuItem("Pulse for an answer") { CheckOnClick = true };
            pulse.CheckedChanged += (_, _) => { demoPulse = pulse.Checked; effects.Asking(Waiting); };
            freshen += () => pulse.Checked = demoPulse;
            items.Add(pulse);
            Line();
            Hears("Chime: a question", Sounds.Cue.Question);
            Hears("Flourish: a milestone", Sounds.Cue.Milestone);
            Hears("Fanfare: all done", Sounds.Cue.Complete);
            Hears("Blip", Sounds.Cue.Blip);
            Line();
            // The whole reaction, exactly as a real one arrives.
            items.Add("A work unit validated", null, (_, _) => Celebrate(big: false));
            items.Add("A build complete", null, (_, _) => Celebrate(big: true));
            items.Add("A question arriving", null, (_, _) => Asked());

            // Nothing moves while his animations are off, and nothing is heard
            // while his sound is: saying so is kinder than doing nothing.
            freshen += () =>
            {
                foreach (Forms.ToolStripItem item in items) item.Enabled = Motion.On;
                foreach (var noise in noises) noise.Enabled = sounds.Enabled;
                preview.Enabled = Motion.On || sounds.Enabled;
            };
            return preview;
        }

        // Tatty's face is a file, assets/tatty.ico (drawn by tools/make-icon), built
        // into the exe as a resource and as its file icon, so the shell shows the
        // same face when he isn't running.
        private static Stream FaceStream() => typeof(App).Assembly.GetManifestResourceStream("tatty.ico")!;

        // The tray's own copy, at the size the tray asks for.
        private static Drawing.Icon MakeIcon()
        {
            using var stream = FaceStream();
            return new Drawing.Icon(stream, Forms.SystemInformation.SmallIconSize);
        }

        // The face for the taskbar button and for Alt-Tab: every size in the file,
        // so WPF picks the one that suits the window's DPI (WM_SETICON, small and big).
        private static ImageSource WindowIcon() =>
            BitmapFrame.Create(FaceStream(), BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
    }
}
