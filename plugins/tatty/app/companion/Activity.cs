using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;

namespace TtCompanion
{
    // What Tatty does while a session works: thinking, reading, writing, running a command,
    // delegating to subagents, waiting on a question, or caught out by a tool that failed
    // (App.xaml.cs works out which from the session's events). The page plays the same in
    // the shop; the avatar's description brings each state here as data (avatar.js's bake:
    // its loop, mouth and lids, its props and its tracks), and this plays it.
    //
    // A track moves one number of a part -- "Pupils.x", "ArmR.a", "Mag.x", "Dot0.o" -- through
    // frames of (value, seconds), eased into each other as Avatar.cs's are, or linearly (lin)
    // or up and back (tri) with a phase. Each part has a layer of its own (a scale and a
    // rotation about its pivot, then a move, as the page composes them), under the
    // transforms Avatar.cs animates, so his bob, blink, hops and celebrations carry on
    // through it all. Only one state plays at a time; a change eases over a third of a second.
    internal sealed class Activity
    {
        internal sealed class Part
        {
            public ScaleTransform S = null!;
            public RotateTransform R = null!;
            public TranslateTransform T = null!;
            public UIElement? Fade;  // what its opacity is set on (a prop's dot, a glow), if anything
            public double O0 = 1;    // its opacity at rest
        }

        private sealed class Track { public string Part = "", Prop = ""; public double[][]? F; public double[]? Lin, Tri; public double Ph, Dur; }
        private sealed class Plan { public double Dur = 1; public string Mouth = "neutral"; public double? Lids; public List<Track> Tracks = new(); }

        private static readonly string[] Props = { "x", "y", "a", "s", "sx", "sy", "o" };

        private readonly Dictionary<string, Plan> plans = new();
        private readonly Dictionary<string, List<Part>> parts; // (a name may be several: the TV's two antenna tips)
        private readonly Dictionary<string, UIElement> mouths;
        private readonly List<(string[] States, UIElement Box)> props;
        private readonly Action idle, busy;
        private readonly Func<bool> lively;

        private string state = "idle";
        private Plan? plan;
        private DateTime started;
        private double lastTick = -1;
        private Dictionary<string, double> shown = new(), from = new();
        private bool ticking;

        public Activity(string? motion, Dictionary<string, List<Part>> parts, Dictionary<string, UIElement> mouths,
                        List<(string[] States, UIElement Box)> props, Action idle, Action busy, Func<bool> lively)
        {
            this.parts = parts;
            this.mouths = mouths;
            this.props = props;
            this.idle = idle;
            this.busy = busy;
            this.lively = lively;
            if (!string.IsNullOrEmpty(motion)) Read(motion!);
        }

        public string State => state;

        private void Read(string json)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                foreach (var st in doc.RootElement.EnumerateObject())
                {
                    var p = new Plan
                    {
                        Dur = st.Value.TryGetProperty("dur", out var d) && d.ValueKind == JsonValueKind.Number ? Math.Max(0.05, d.GetDouble()) : 1,
                        Mouth = st.Value.TryGetProperty("mouth", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString()! : "neutral",
                        Lids = st.Value.TryGetProperty("lids", out var l) && l.ValueKind == JsonValueKind.Number ? l.GetDouble() : null,
                    };
                    if (st.Value.TryGetProperty("tracks", out var tracks) && tracks.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var t in tracks.EnumerateArray())
                        {
                            string name = t.TryGetProperty("p", out var pn) ? pn.GetString() ?? "" : "";
                            int dot = name.LastIndexOf('.');
                            if (dot <= 0) continue;
                            var tr = new Track
                            {
                                Part = name.Substring(0, dot), Prop = name.Substring(dot + 1),
                                F = Pairs(t, "f"), Lin = Pair(t, "lin"), Tri = Pair(t, "tri"),
                                Ph = t.TryGetProperty("ph", out var ph) && ph.ValueKind == JsonValueKind.Number ? ph.GetDouble() : 0,
                                Dur = t.TryGetProperty("dur", out var td) && td.ValueKind == JsonValueKind.Number ? td.GetDouble() : 0,
                            };
                            if (tr.F == null && tr.Lin == null && tr.Tri == null) continue;
                            p.Tracks.Add(tr);
                        }
                    }
                    plans[st.Name] = p;
                }
            }
            catch (Exception)
            {
                plans.Clear(); // a description whose motion doesn't read plays nothing
            }
        }

        private static double[]? Pair(JsonElement t, string name) =>
            t.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array && v.GetArrayLength() == 2
                ? v.EnumerateArray().Select(x => x.GetDouble()).ToArray() : null;

        private static double[][]? Pairs(JsonElement t, string name) =>
            t.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array && v.GetArrayLength() > 0
                ? v.EnumerateArray().Select(f => f.EnumerateArray().Select(x => x.GetDouble()).ToArray()).Where(f => f.Length == 2).ToArray() : null;

        // ---------------------------------------------------------------- playing

        // What he is doing now ("idle" or a state of the description's). The same state again changes nothing.
        public void Set(string next)
        {
            if (next == state && (plan != null || next == "idle")) return;
            state = next;
            plan = plans.GetValueOrDefault(next);
            from = new Dictionary<string, double>(shown);
            started = DateTime.UtcNow;
            foreach (var (states, box) in props) box.Visibility = plan != null && states.Contains(next) ? Visibility.Visible : Visibility.Collapsed;
            if (plan == null)
            {
                Stop();
                Rest();
                idle(); // his own mouth and his own parts' idle motion back
                return;
            }
            busy(); // his own parts' idle motion stops: this state moves them now
            Mouth(plan.Mouth);
            if (lively()) Start();
            else { Stop(); Frame(0); }
        }

        private void Start()
        {
            if (ticking) return;
            ticking = true;
            CompositionTarget.Rendering += OnRendering;
        }

        // No more frames (a new look is taking over).
        public void Halt() => Stop();

        private void Stop()
        {
            if (!ticking) return;
            ticking = false;
            CompositionTarget.Rendering -= OnRendering;
        }

        private void OnRendering(object? sender, EventArgs e)
        {
            double t = (DateTime.UtcNow - started).TotalSeconds;
            if (lastTick >= 0 && t >= lastTick && t - lastTick < 0.03) return; // about 30 frames a second
            lastTick = t;
            Frame(t);
        }

        private void Frame(double t)
        {
            if (plan == null) return;
            var v = new Dictionary<string, double>();
            foreach (var tr in plan.Tracks) v[tr.Part + "." + tr.Prop] = Eval(tr, t, plan.Dur);
            if (plan.Lids is double lids) v["Eyes.sy"] = (v.TryGetValue("Eyes.sy", out var sy) ? sy : 1) * lids;
            double blend = t / 0.35;
            if (blend < 1)
            {
                double e = Ease(blend);
                foreach (var k in v.Keys.Union(from.Keys).ToList())
                {
                    double a = from.TryGetValue(k, out var fa) ? fa : RestValue(k), b = v.TryGetValue(k, out var vb) ? vb : RestValue(k);
                    v[k] = a + (b - a) * e;
                }
            }
            shown = v;
            foreach (var (name, list) in parts)
                foreach (var part in list) Put(part, k => v.TryGetValue(name + "." + k, out var x) ? x : (double?)null);
            Mouth(plan.Mouth); // (a pose change in Avatar.cs may have put his own back)
        }

        // Every part back where it rests.
        private void Rest()
        {
            shown = new Dictionary<string, double>();
            foreach (var part in parts.Values.SelectMany(x => x)) Put(part, _ => null);
        }

        // a number's value at rest: no move, no turn, full size, and the part's own opacity
        private double RestValue(string key) => key.EndsWith(".o") ? (parts.TryGetValue(key[..key.LastIndexOf('.')], out var p) && p.Count > 0 ? p[0].O0 : 1)
            : key.EndsWith(".s") || key.EndsWith(".sx") || key.EndsWith(".sy") ? 1 : 0;

        private static void Put(Part p, Func<string, double?> get)
        {
            double s = get("s") ?? 1;
            Set(p.S, ScaleTransform.ScaleXProperty, get("sx") ?? s);
            Set(p.S, ScaleTransform.ScaleYProperty, get("sy") ?? s);
            Set(p.R, RotateTransform.AngleProperty, get("a") ?? 0);
            Set(p.T, TranslateTransform.XProperty, get("x") ?? 0);
            Set(p.T, TranslateTransform.YProperty, get("y") ?? 0);
            if (p.Fade != null) p.Fade.Opacity = Math.Clamp(get("o") ?? p.O0, 0, 1);
        }

        private static void Set(DependencyObject o, DependencyProperty prop, double value)
        {
            if (!Equals(o.GetValue(prop), value)) o.SetValue(prop, value);
        }

        private void Mouth(string name)
        {
            if (!mouths.ContainsKey(name)) name = "neutral";
            foreach (var (k, m) in mouths)
            {
                var want = k == name ? Visibility.Visible : Visibility.Collapsed;
                if (m.Visibility != want) m.Visibility = want;
            }
        }

        // ---------------------------------------------------------------- the tracks (avatar.js's, the same sums)

        private static double Ease(double u) => (1 - Math.Cos(Math.PI * Math.Clamp(u, 0, 1))) / 2;
        private static double Frac(double x) => ((x % 1) + 1) % 1;

        private static double Eval(Track tr, double t, double dur)
        {
            double d = tr.Dur > 0 ? tr.Dur : dur, lt = ((t % d) + d) % d;
            if (tr.Lin != null) return tr.Lin[0] + (tr.Lin[1] - tr.Lin[0]) * Frac(lt / d + tr.Ph);
            if (tr.Tri != null) return tr.Tri[0] + (tr.Tri[1] - tr.Tri[0]) * Math.Sin(Math.PI * Frac(lt / d + tr.Ph));
            var f = tr.F!;
            if (f.Length == 1 || lt <= f[0][1]) return f[0][0];
            for (int i = 1; i < f.Length; i++)
            {
                if (lt <= f[i][1])
                {
                    double t0 = f[i - 1][1], t1 = f[i][1];
                    return f[i - 1][0] + (f[i][0] - f[i - 1][0]) * Ease(t1 > t0 ? (lt - t0) / (t1 - t0) : 1);
                }
            }
            return f[^1][0];
        }
    }
}
