using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
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
        private TattyWindow tatty = null!;
        private BubbleWindow bubble = null!;
        private Forms.NotifyIcon tray = null!;
        private HttpClient http = null!;
        private readonly DispatcherTimer poll = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        private readonly DispatcherTimer tuck = new DispatcherTimer { Interval = TimeSpan.FromSeconds(10) };
        private readonly HashSet<string> openAsks = new HashSet<string>();
        private string home = "";
        private (int Port, string Token) server;
        private int since = -1;
        private int failures;
        private bool polling;
        private bool tattyPlaced;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);
            if (Array.IndexOf(e.Args, "--pick-folder") >= 0) { PickFolderAndExit(e.Args); return; }
            single = new Mutex(true, @"Local\tatty-companion", out bool first);
            if (!first) { Shutdown(0); return; }

            home = Arg(e.Args, "--home") ?? DefaultHome();
            var info = ReadServer(home);
            if (info == null) { Shutdown(1); return; }
            Connect(info.Value);

            string dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tatty", "webview2");
            tatty = new TattyWindow();
            bubble = new BubbleWindow(PageUrl(info.Value), dataDir);
            tatty.Clicked += ToggleBubble;
            tatty.Moved += () => { tattyPlaced = true; if (bubble.IsVisible && !bubble.IsExpanded) PlaceBubble(); };
            bubble.PageMessage += OnPageMessage;
            // A collapse lands a frame later; the full panel places itself.
            bubble.SizeChanged += (_, _) => { if (bubble.IsVisible && !bubble.IsExpanded) PlaceBubbleOnce(); };
            tuck.Tick += (_, _) => TryTuck();

            tray = MakeTray();
            PopUp(activate: false);
            poll.Tick += async (_, _) => await Poll();
            poll.Start();
        }

        protected override void OnExit(ExitEventArgs e)
        {
            bubble?.SaveBounds();
            if (tray != null) { tray.Visible = false; tray.Dispose(); }
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
                bool attention = false, question = false;
                foreach (var ev in events.EnumerateArray())
                {
                    since = ev.GetProperty("seq").GetInt32();
                    string type = ev.GetProperty("type").GetString() ?? "";
                    if (type == "ask") { openAsks.Add(ev.GetProperty("id").GetString() ?? ""); question = true; }
                    else if (type == "answered") openAsks.Remove(ev.GetProperty("id").GetString() ?? "");
                    else if (type == "card" && ev.TryGetProperty("kind", out var kind) && kind.GetString() == "reply") attention = true;
                }
                if (first) { since = Math.Max(since, 0); question = openAsks.Count > 0; attention = false; }
                tatty.HasBadge = openAsks.Count > 0;
                if (question || attention) PopUp(activate: false);
                if (openAsks.Count == 0 && bubble.IsVisible && !tuck.IsEnabled) tuck.Start();
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
                    Shutdown(0);
                }
            }
            finally { polling = false; }
        }

        private async Task StopServer()
        {
            try { await http.PostAsync("/api/stop", new StringContent("{}", Encoding.UTF8, "application/json")); } catch (Exception) { }
            Shutdown(0);
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
            string? start = null, title = null;
            try
            {
                using var doc = JsonDocument.Parse(arg ?? "{}");
                if (doc.RootElement.TryGetProperty("start", out var s)) start = s.GetString();
                if (doc.RootElement.TryGetProperty("title", out var t)) title = t.GetString();
            }
            catch (JsonException) { }
            PickFolder(start, title);
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
            if (!bubble.IsExpanded) PlaceBubble();
            tatty.Hop();
            bubble.Post("shown");
            if (activate) bubble.Activate();
        }

        private void ToggleBubble()
        {
            if (bubble.IsVisible) { bubble.Hide(); return; }
            PopUp(activate: false);
        }

        private void TryTuck()
        {
            // Not while there's something to answer, the person is in it, or it's the full panel.
            if (openAsks.Count > 0 || bubble.IsExpanded || bubble.IsActive || bubble.IsMouseOver || tatty.IsMouseOver) return;
            tuck.Stop();
            bubble.Hide();
            tatty.Hide();
            tattyPlaced = false;
        }

        private void OnPageMessage(string type) => OnPageMessage(type, null);

        private void OnPageMessage(string type, string? arg)
        {
            switch (type)
            {
                case "pick-root": PickRoot(arg); break;
                case "pick-folder": PickFolderFromPage(arg); break;
                // The page is about to have the server open a new session's
                // window: let that window come to the front (Tatty has the focus now).
                case "allow-foreground": Native.AllowAnyForeground(); break;
                case "expand": bubble.SetExpanded(true); bubble.Activate(); break;
                case "collapse": bubble.SetExpanded(false); PlaceBubble(); break;
                case "drag": bubble.Drag(); break;
                case "maximise": bubble.ToggleMaximise(); break;
                case "hide": bubble.Hide(); tatty.Hide(); tattyPlaced = false; break;
            }
        }

        private void PlaceTatty()
        {
            var wa = Native.WorkAreaUnderPointer();
            var r = Native.Rect(tatty);
            Native.MoveTo(tatty, wa.Right - r.Width - 24, wa.Bottom - r.Height - 8);
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
            int x = t.Right - b.Width, y = t.Top - b.Height - 6;
            if (y < wa.Top) { x = t.Left - b.Width - 6; y = t.Bottom - b.Height; }
            x = Math.Clamp(x, wa.Left, Math.Max(wa.Left, wa.Right - b.Width));
            y = Math.Clamp(y, wa.Top, Math.Max(wa.Top, wa.Bottom - b.Height));
            Native.MoveTo(bubble, x, y);
        }

        // ------------------------------------------------------------ tray

        private Forms.NotifyIcon MakeTray()
        {
            var menu = new Forms.ContextMenuStrip();
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
            menu.Items.Add("Close Tatty's window", null, async (_, _) => await StopServer());
            menu.Items.Add("Quit Tatty", null, (_, _) => Shutdown(0));
            var icon = new Forms.NotifyIcon { Icon = DrawIcon(), Text = "Tatty", ContextMenuStrip = menu, Visible = true };
            icon.MouseClick += (_, e) => { if (e.Button == Forms.MouseButtons.Left) ToggleBubble(); };
            return icon;
        }

        // Tatty's face, drawn here so there's no binary icon file to keep.
        private static Drawing.Icon DrawIcon()
        {
            using var bmp = new Drawing.Bitmap(32, 32);
            using (var g = Drawing.Graphics.FromImage(bmp))
            {
                g.SmoothingMode = Drawing.Drawing2D.SmoothingMode.AntiAlias;
                var accent = Drawing.Color.FromArgb(0x3B, 0x6E, 0xA8);
                using var pen = new Drawing.Pen(accent, 2.5f);
                using var face = new Drawing.SolidBrush(Drawing.Color.FromArgb(0xFD, 0xFC, 0xF9));
                using var dark = new Drawing.SolidBrush(Drawing.Color.FromArgb(0x1F, 0x23, 0x28));
                using var head = new Drawing.Drawing2D.GraphicsPath();
                var r = new Drawing.Rectangle(3, 8, 26, 21);
                int d = 8;
                head.AddArc(r.Left, r.Top, d, d, 180, 90);
                head.AddArc(r.Right - d, r.Top, d, d, 270, 90);
                head.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
                head.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
                head.CloseFigure();
                g.FillPath(face, head);
                g.DrawPath(pen, head);
                g.DrawLine(pen, 16, 2, 16, 8);
                g.FillEllipse(dark, 9, 14, 5, 5);
                g.FillEllipse(dark, 18, 14, 5, 5);
            }
            return Drawing.Icon.FromHandle(bmp.GetHicon());
        }
    }
}
