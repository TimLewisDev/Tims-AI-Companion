using System;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Shell;
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
        public bool IsExpanded { get; private set; }
        public bool IsMaximised { get; private set; }

        private string url;
        private string origin;
        private readonly string dataDir;
        private Native.RECT restore;

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
                Native.MakeToolWindow(this, noActivate: false);
                Native.RoundCorners(this, 0x3B6EA8);
            };
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
            Post(on ? "expanded" : "compact");
        }

        // Where the panel was last left (if that is still on a screen), else centred.
        private void OpenWhereLeft()
        {
            var saved = LoadBounds();
            if (saved is { } r && Native.OnSomeScreen(r)) { Native.SetBounds(this, r.X, r.Y, r.Width, r.Height); return; }
            var wa = Native.WorkAreaOf(this);
            double s = Native.Scale(this);
            int w = (int)Math.Min(FullWidth * s, wa.Width), h = (int)Math.Min(FullHeight * s, wa.Height);
            Native.SetBounds(this, wa.Left + (wa.Width - w) / 2, wa.Top + (wa.Height - h) / 2, w, h);
        }

        // Fill the monitor's work area (the taskbar stays visible), or go back.
        public void ToggleMaximise()
        {
            if (!IsExpanded) return;
            if (!IsMaximised)
            {
                restore = Native.Rect(this);
                var wa = Native.WorkAreaOf(this);
                Native.SetBounds(this, wa.Left, wa.Top, wa.Width, wa.Height);
                IsMaximised = true;
            }
            else
            {
                Native.SetBounds(this, restore.Left, restore.Top, restore.Width, restore.Height);
                IsMaximised = false;
            }
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

        public void SaveBounds()
        {
            if (!IsExpanded) return;
            var r = IsMaximised ? restore : Native.Rect(this);
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
