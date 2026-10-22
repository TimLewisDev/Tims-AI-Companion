using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Shell;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace TtCompanion
{
    // The speech bubble: hosts Tatty's page (?mode=companion) in WebView2.
    // Compact, it sits beside Tatty and the App places it. Expanded, it is the
    // full panel: moved by dragging its bar, resized from any edge, maximised to
    // fill the monitor, and it reopens where it was left. The page asks for all
    // of that with chrome.webview.postMessage; links that leave the server open
    // in the person's own browser.
    public partial class BubbleWindow : Window
    {
        public const double CompactWidth = 380, CompactHeight = 440, FullWidth = 1040, FullHeight = 720;
        private const double Edge = 6; // the resize border, in WPF units

        public event Action<string, string?>? PageMessage; // type, and an optional arg
        public event Action<bool>? PanelOwnsButton; // true while the panel has a taskbar button of its own
        public event Action? Restored;      // back up from the taskbar
        public event Action? WentToTaskbar; // down into it: the button, Win+D, Minimize all
        public event Action? Woken;         // the person is in it, so don't tuck it away now
        public event Action? AskedToClose;  // Close, from the taskbar button's own menu
        public bool IsExpanded { get; private set; }
        public bool IsMaximised { get; private set; }

        // On the screen, rather than merely not hidden: a window down in the
        // taskbar is still "visible" as far as WPF and the shell are concerned.
        public bool IsShown => IsVisible && !Native.IsMinimised(this);

        // Set just before the app leaves. Tatty's windows refuse to be closed --
        // closing one is how a person says "put it away" -- and a refusal would
        // cancel the shutdown with them, leaving the process behind with nothing.
        public static bool Quitting { get; set; }

        private string url;
        private string origin;
        private readonly string dataDir;
        private Native.RECT restore;
        // Where the panel last really was. A minimised window's rectangle is its
        // icon's, far off the side of the desktop, and must never be the one saved.
        private Native.RECT lastNormal;
        private WindowState wasState = WindowState.Normal;
        private bool takingOverSnap;
        // A forced kill never runs OnExit, and where the panel was would go with
        // it. Written a moment after the person stops moving or resizing it.
        private readonly DispatcherTimer settle = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2) };

        private static string BoundsFile => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tatty", "companion.json");

        public BubbleWindow(string url, string dataDir)
        {
            this.url = url;
            this.dataDir = dataDir;
            origin = new Uri(url).GetLeftPart(UriPartial.Authority);
            InitializeComponent();
            SourceInitialized += (_, _) =>
            {
                Native.RoundCorners(this, 0x3B6EA8);
                Apply();
            };
            // Coming and going changes what the shell should make of this window
            // as much as changing shape does.
            IsVisibleChanged += (_, _) => Apply();
            StateChanged += OnStateChanged;
            Activated += (_, _) => Woken?.Invoke();
            LocationChanged += (_, _) => RememberWhere();
            SizeChanged += (_, _) => RememberWhere();
            // The taskbar button's menu offers Close, and closing this window
            // would take the page and its WebView2 with it and leave a tray app
            // with nothing behind it. Tatty is tucked away instead -- unless the
            // app really is leaving, when refusing would strand the process.
            Closing += (_, e) =>
            {
                if (Quitting) return;
                e.Cancel = true;
                AskedToClose?.Invoke();
            };
            settle.Tick += (_, _) => { settle.Stop(); SaveBounds(); };
            Loaded += async (_, _) => await StartPage();
        }

        private async Task StartPage()
        {
            // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS (e.g. a DevTools port for tests)
            // is read by WebView2 itself.
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await Web.EnsureCoreWebView2Async(env);
            Web.DefaultBackgroundColor = System.Drawing.Color.FromArgb(0xF7, 0xF6, 0xF3);
            var core = Web.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsZoomControlEnabled = false;
            core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
            core.NavigationStarting += (_, e) =>
            {
                if (e.Uri.StartsWith(origin, StringComparison.OrdinalIgnoreCase)) return;
                e.Cancel = true;
                OpenExternal(e.Uri);
            };
            core.WebMessageReceived += (_, e) =>
            {
                try
                {
                    using var doc = JsonDocument.Parse(e.WebMessageAsJson);
                    var m = doc.RootElement;
                    if (!m.TryGetProperty("type", out var type)) return;
                    string? arg = m.TryGetProperty("arg", out var a) && a.ValueKind == JsonValueKind.String ? a.GetString() : null;
                    PageMessage?.Invoke(type.GetString() ?? "", arg);
                }
                catch (JsonException) { }
            };
            Web.Source = new Uri(url);
        }

        // A new server (the window was reopened): load its page.
        public void Navigate(string newUrl)
        {
            url = newUrl;
            origin = new Uri(newUrl).GetLeftPart(UriPartial.Authority);
            if (Web.CoreWebView2 != null) Web.CoreWebView2.Navigate(newUrl);
        }

        public void Post(string message)
        {
            try { Web.CoreWebView2?.PostWebMessageAsString(message); } catch (InvalidOperationException) { }
        }

        public void SetExpanded(bool on)
        {
            if (IsExpanded && !on) SaveBounds();
            IsExpanded = on;
            IsMaximised = false;
            // Real resize edges on a borderless window. WebView2 is a child window
            // that would take the mouse at the very edge, so it sits inside them.
            WindowChrome.SetWindowChrome(this, new WindowChrome
            {
                CaptionHeight = 0,
                GlassFrameThickness = new Thickness(0),
                UseAeroCaptionButtons = false,
                ResizeBorderThickness = new Thickness(on ? Edge : 0),
            });
            ResizeMode = on ? ResizeMode.CanResize : ResizeMode.NoResize;
            MinWidth = on ? 560 : 0;
            MinHeight = on ? 380 : 0;
            Web.Margin = new Thickness(on ? Edge : 0);
            if (on) OpenWhereLeft();
            else { Width = CompactWidth; Height = CompactHeight; } // the App puts it beside Tatty
            Apply();
            Post(on ? "expanded" : "compact");
        }

        // Everything the shell needs to know about this window is decided here and
        // nowhere else, so no two of Alt-Tab, the taskbar and what floats on top
        // can drift apart. Called last, after every change of shape or state: the
        // window itself is never recreated, because the page and its WebView2
        // would go down with it.
        private void Apply()
        {
            bool panel = IsExpanded; // expanded or maximised
            bool iconic = Native.IsMinimised(this);
            // Only the compact bubble floats above other windows (with Tatty); the
            // full and maximised panel are ordinary windows that others can cover.
            // The property, not the style, so WPF keeps it over a hide and a show;
            // saying it again over the top is the foreground watcher's job.
            Topmost = !panel && !iconic;
            // Only the full and maximised panel joins Alt-Tab. Not while the window
            // is an icon in the taskbar: it keeps the shape it had, and the shell
            // reads these on the way back.
            if (!iconic) Native.SetAltTab(this, panel);
            // Joining Alt-Tab brings a taskbar button with it, and Tatty already
            // has one of those. Whoever is listening takes the other one away, so
            // there is never a second button for the same robot.
            PanelOwnsButton?.Invoke(panel && IsVisible);
        }

        // Where the panel was last left (if that is still on a screen), else centred.
        private void OpenWhereLeft()
        {
            var saved = LoadBounds();
            if (saved is { } r && Native.OnSomeScreen(r)) { Native.SetBounds(this, r.X, r.Y, r.Width, r.Height); RememberWhere(); return; }
            var wa = Native.WorkAreaOf(this);
            double s = Native.Scale(this);
            int w = (int)Math.Min(FullWidth * s, wa.Width), h = (int)Math.Min(FullHeight * s, wa.Height);
            Native.SetBounds(this, wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2, w, h);
            RememberWhere();
        }

        // Down into the taskbar and back up again. The button is already there,
        // whether this window's own or the proxy's, so there is something to
        // click; everything that follows is handled in OnStateChanged.
        public void Minimise() => Native.Minimise(this);
        public void Restore() => Native.Restore(this);

        // Minimised, restored, or maximised by Windows itself rather than by us.
        private void OnStateChanged(object? sender, EventArgs e)
        {
            if (takingOverSnap) return;
            // Windows' own maximise: Win+Up, or the panel dragged to the top of
            // the screen. The panel keeps its own idea of maximised -- an ordinary
            // window the size of the work area -- so that one rectangle is the
            // whole truth, the page's button says the right thing and dragging it
            // knows where to put it back. Take Windows' version over as ours.
            if (WindowState == WindowState.Maximized)
            {
                takingOverSnap = true;
                WindowState = WindowState.Normal;
                takingOverSnap = false;
                wasState = WindowState.Normal;
                if (!IsExpanded || IsMaximised) return;
                restore = lastNormal;
                FillWorkArea();
                IsMaximised = true;
                Apply();
                Post("maximised");
                return;
            }
            var from = wasState;
            wasState = WindowState;
            Apply();
            if (WindowState == WindowState.Minimized) WentToTaskbar?.Invoke();
            else if (from == WindowState.Minimized) Restored?.Invoke();
        }

        private void FillWorkArea()
        {
            var wa = Native.WorkAreaOf(this);
            Native.SetBounds(this, wa.Left, wa.Top, wa.Width, wa.Height);
        }

        // Fill the monitor's work area (the taskbar stays visible), or go back.
        public void ToggleMaximise()
        {
            if (!IsExpanded) return;
            if (!IsMaximised)
            {
                restore = Native.Rect(this);
                FillWorkArea();
                IsMaximised = true;
            }
            else
            {
                Native.SetBounds(this, restore.Left, restore.Top, restore.Width, restore.Height);
                IsMaximised = false;
            }
            Apply();
            Post(IsMaximised ? "maximised" : "restored");
        }

        // Move the panel with the mouse. A maximised panel comes back to its
        // normal size first, under the pointer, as a normal window does.
        public void Drag()
        {
            if (!IsExpanded) return;
            if (IsMaximised)
            {
                var p = Native.Pointer();
                int w = restore.Width, h = restore.Height;
                Native.SetBounds(this, p.X - w / 2, p.Y - 16, w, h);
                IsMaximised = false;
                Post("restored");
            }
            Native.StartDrag(this);
        }

        // Only ever where the panel really was: not its icon's corner of nowhere,
        // and not a rectangle so small that reopening would be a puzzle.
        private void RememberWhere()
        {
            if (!IsExpanded || IsMaximised || Native.IsMinimised(this)) return;
            lastNormal = Native.Rect(this);
            settle.Stop();
            settle.Start();
        }

        public void SaveBounds()
        {
            if (!IsExpanded) return;
            var r = IsMaximised ? restore : Native.IsMinimised(this) ? lastNormal : Native.Rect(this);
            if (r.Width < 100 || r.Height < 100) return;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(BoundsFile)!);
                File.WriteAllText(BoundsFile, JsonSerializer.Serialize(new { x = r.Left, y = r.Top, w = r.Width, h = r.Height }));
            }
            catch (Exception) { }
        }

        private static System.Drawing.Rectangle? LoadBounds()
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(BoundsFile));
                var e = doc.RootElement;
                return new System.Drawing.Rectangle(e.GetProperty("x").GetInt32(), e.GetProperty("y").GetInt32(),
                                                    e.GetProperty("w").GetInt32(), e.GetProperty("h").GetInt32());
            }
            catch (Exception) { return null; }
        }

        private static void OpenExternal(string uri)
        {
            if (!uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && !uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return;
            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch (Exception) { }
        }
    }
}
