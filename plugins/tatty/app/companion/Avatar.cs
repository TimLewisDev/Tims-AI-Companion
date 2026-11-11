using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace TtCompanion
{
    // What Tatty can do on his own: one-shot performances.
    internal enum Act { Hop, Startle, Alert, Dance, Stretch, LookAround, Yawn, Celebrate, CelebrateBig }

    // ... and how he holds himself between them.
    internal enum Pose { Stand, Sit, Doze, Asleep }

    // Tatty's animation. He bobs and blinks as he always did; left alone he
    // fidgets -- a look about, a dance from foot to foot, a sit down -- then
    // dozes, then falls asleep, and wakes with a start at the first sign of
    // anything happening. Poke() is that sign, and the only thing the rest of the
    // app has to remember: every server event, and every hover, click and drag,
    // is one.
    //
    // Everything here animates the transforms TattyWindow.xaml names, so the
    // drawing stays in the XAML and the movement stays here. Two properties are
    // owned outright to keep the clocks from fighting over them: BodyShift.Y is
    // the idle bob's and Blink.ScaleY the blink's and the poses', so a
    // performance uses the root transforms, the legs and the pupils instead.
    internal sealed class Avatar
    {
        // How long he is left alone before each step down, and the gap between
        // fidgets. TATTY_ANIM_FAST divides them all, because nobody wants to wait
        // ten minutes to see whether he snores.
        private const double IdleAfter = 45, DozeAfter = 300, SleepAfter = 600, FidgetGap = 20;
        private const double SitDrop = 12, SitFold = 72; // how far he sinks and how far his legs splay

        private static readonly IEasingFunction Ease = new SineEase { EasingMode = EasingMode.EaseInOut };

        private readonly TattyWindow w;
        private readonly DispatcherTimer blink = new DispatcherTimer();
        private readonly DispatcherTimer ladder = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        private readonly Random random = new Random();
        private readonly double hurry = Environment.GetEnvironmentVariable("TATTY_ANIM_FAST") == "1" ? 9 : 1;

        private Storyboard? running;
        private DateTime busyUntil, poked, nextFidget, sitUntil;
        private Pose pose = Pose.Stand;

        // What a working session has him doing (see SetState): the state on show, what the session says it
        // is (wanted) and a state picked off his menu to watch (previewing, for a few seconds). Everything a
        // state moves is kept in `driven`, so it can be put back when the state ends.
        private AvatarArt.StateDef? state;
        private string? wanted, previewing;
        private double baseLids = 1;
        private DispatcherTimer? settle, previewEnd;
        private double? freezeAt;  // set only by SnapState: every part held at this moment of the state (the render check)
        private readonly List<Driven> driven = new();

        private sealed record Driven(IAnimatable Target, DependencyProperty Prop, double Rest, bool OfProp, AvatarArt.Track Track);

        public Avatar(TattyWindow window) => w = window;

        // Sitting down and getting up are worth knowing about outside: that is
        // when the Zzz's start and stop (App.xaml.cs, Effects.cs).
        public event Action<Pose>? PoseChanged;

        public Pose Pose => pose;

        public void Start()
        {
            poked = nextFidget = DateTime.UtcNow;
            blink.Tick += (_, _) => Blink();
            blink.Interval = TimeSpan.FromSeconds(2);
            blink.Start();
            ladder.Tick += (_, _) => Tick();
            ladder.Start();
            Bob();
        }

        // Something happened (or someone reached for him): stand up, open your
        // eyes, and start counting the quiet again.
        public void Poke()
        {
            poked = DateTime.UtcNow;
            if (pose == Pose.Stand) return;
            bool sleeping = pose == Pose.Asleep || pose == Pose.Doze;
            Set(Pose.Stand);
            if (sleeping) Perform(Act.Startle);
        }

        // One performance at a time. A fidget waits its turn and is dropped if it
        // misses it; the two that are the whole point -- a question, a milestone --
        // cut in.
        public void Perform(Act act) =>
            Run(act, cutsIn: act == Act.Alert || act == Act.Celebrate || act == Act.CelebrateBig);

        // One asked for by name, from his own menu. It cuts in, because somebody
        // who has just picked a performance off a menu should see that one and
        // not whatever he happened to be doing, and the quiet starts again, so
        // he doesn't wander off into a fidget while it is being watched.
        public void Preview(Act act)
        {
            poked = DateTime.UtcNow;
            Run(act, cutsIn: true);
        }

        // A pose held for as long as it is wanted: the ladder is wound back, so
        // nothing stands him up or sends him to sleep until something really
        // happens (any Poke, including a hand reaching for him).
        public void Preview(Pose held)
        {
            previewing = null;
            Show(null);
            poked = DateTime.UtcNow;
            sitUntil = DateTime.UtcNow + Seconds(600);
            Set(held);
        }

        private void Run(Act act, bool cutsIn)
        {
            if (!Lively) return;
            if (DateTime.UtcNow < busyUntil && !cutsIn) return;
            double wait = 0;
            if ((pose == Pose.Sit || pose == Pose.Asleep) && Standing(act))
            {
                Set(Pose.Stand);
                wait = 0.22; // let him get up first, rather than animate from a snap
            }
            Play(Build(act), wait);
        }

        // Whether he may move (Motion, in Settings.cs). With it off he still bobs
        // and blinks, and that is all.
        private static bool Lively => Motion.On;

        // The performances that move him off the spot, and so can't be done sat down.
        private static bool Standing(Act act) => act != Act.LookAround && act != Act.Yawn;

        private double Quiet => (DateTime.UtcNow - poked).TotalSeconds * hurry;

        // ------------------------------------------------------------ the ladder

        private void Tick()
        {
            if (!Lively || state != null) return;  // (working, he doesn't fidget or doze off)
            var now = DateTime.UtcNow;
            double quiet = Quiet;
            if (quiet >= SleepAfter) Set(Pose.Asleep);
            else if (quiet >= DozeAfter) Set(Pose.Doze);
            else if (pose == Pose.Sit && now >= sitUntil) Set(Pose.Stand);

            if (pose == Pose.Asleep || quiet < IdleAfter || now < busyUntil || now < nextFidget) return;
            nextFidget = now + Seconds((FidgetGap + random.NextDouble() * FidgetGap) / hurry);
            if (pose == Pose.Doze) Perform(Act.Yawn);
            else Fidget();
        }

        private void Fidget()
        {
            switch (random.Next(10))
            {
                case 0: case 1: case 2: Perform(Act.LookAround); break;
                case 3: case 4: case 5: Perform(Act.Dance); break;
                case 6: case 7: Perform(Act.Stretch); break;
                default:
                    if (pose != Pose.Stand) { Perform(Act.LookAround); break; }
                    Set(Pose.Sit);
                    sitUntil = DateTime.UtcNow + Seconds((40 + random.Next(40)) / hurry);
                    break;
            }
        }

        // ------------------------------------------------------------ poses

        private void Set(Pose next)
        {
            if (pose == next) return;
            pose = next;
            bool sat = next == Pose.Sit || next == Pose.Asleep;
            Lift(sat ? SitDrop : 0, 0.45);
            Fold(sat ? SitFold : 0);
            Lids(LidsFor(next));
            Mouth(next == Pose.Asleep);
            Hold(w.PupilShift, TranslateTransform.XProperty, 0, 0.3);
            Bob();
            if (next == Pose.Stand || next == Pose.Sit) blink.Start(); else blink.Stop();
            PoseChanged?.Invoke(next);
        }

        private static double LidsFor(Pose p) => p switch { Pose.Doze => 0.45, Pose.Asleep => 0.08, _ => 1 };

        // The idle bob: slower and shallower the sleepier he is. It owns
        // BodyShift.Y, so it survives every performance underneath it.
        private void Bob()
        {
            (double rise, double seconds) = state != null && pose == Pose.Stand ? (state.BobRise, state.BobSeconds) : pose switch
            {
                Pose.Sit => (3.0, 2.2),
                Pose.Doze => (3.0, 2.6),
                Pose.Asleep => (2.5, 3.6),
                _ => (4.0, 1.6),
            };
            w.BodyShift.BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimation(0, -rise, Seconds(seconds))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = Ease,
                });
        }

        private void Blink()
        {
            w.Blink.BeginAnimation(ScaleTransform.ScaleYProperty,
                new DoubleAnimation(baseLids, 0.1, TimeSpan.FromMilliseconds(90)) { AutoReverse = true });
            blink.Interval = Seconds(3 + random.NextDouble() * 4);
        }

        private void Lift(double to, double seconds) => Hold(w.RootLift, TranslateTransform.YProperty, to, seconds);
        private void Lids(double to) => Hold(w.Blink, ScaleTransform.ScaleYProperty, to, 0.25);

        private void Fold(double to)
        {
            Hold(w.LegLFold, RotateTransform.AngleProperty, to, 0.45);
            Hold(w.LegRFold, RotateTransform.AngleProperty, -to, 0.45);
        }

        private void Mouth(bool asleep)
        {
            w.MouthF.Visibility = asleep ? Visibility.Visible : Visibility.Collapsed;
            w.MouthN.Visibility = asleep ? Visibility.Collapsed : Visibility.Visible;
            w.MouthH.Visibility = Visibility.Collapsed;
        }

        // A new drawing (an avatar from the shop, TattyWindow.Apply): its mouths take up the pose, and the
        // state he was in is played again in it (the old drawing's parts are gone, and what was driven with them).
        public void Refresh()
        {
            settle?.Stop();
            driven.Clear();
            state = null;
            baseLids = 1;
            Mouth(pose == Pose.Asleep);
            Show(previewing ?? wanted);
        }

        // A value animated to and then kept: the pose is where he stays until
        // something changes it, so these hold their end rather than snapping back.
        private static void Hold(IAnimatable part, DependencyProperty prop, double to, double seconds) =>
            part.BeginAnimation(prop, new DoubleAnimation(to, Seconds(seconds)) { EasingFunction = Ease });

        // ------------------------------------------------------------ what the session is doing

        // The server's say (an "avatar" event): thinking, reading, writing, running, delegating, needs or
        // oops, or idle / nothing. He plays the state until it changes. A performance (the alert for a
        // question, a celebration) cuts in and he goes back to it.
        public void SetState(string? id)
        {
            wanted = string.IsNullOrEmpty(id) || id == "idle" ? null : id;
            if (previewing == null) Show(wanted);
        }

        // Every part of a state held at one moment of it, with nothing running: for drawing a state to a picture
        // (App.RenderStates), which is how the port is checked against the page's own.
        internal void SnapState(string id, double t)
        {
            freezeAt = null;
            Show(null);
            freezeAt = t;
            Show(id);
        }

        // One asked for by name from his menu: shown for a few seconds whatever the session is doing, then
        // back to what it is doing.
        public void PreviewState(string id)
        {
            previewing = id;
            poked = DateTime.UtcNow;
            previewEnd ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(8) };
            previewEnd.Stop();
            previewEnd.Tick -= EndPreview;
            previewEnd.Tick += EndPreview;
            previewEnd.Start();
            Show(id);
        }

        private void EndPreview(object? sender, EventArgs e)
        {
            previewEnd?.Stop();
            previewing = null;
            Show(wanted);
        }

        private void Show(string? id)
        {
            var art = w.Art;
            var next = id != null && art != null && art.States.TryGetValue(id, out var def) ? def : null;
            if (next == state) return;
            EndState();
            state = next;
            poked = DateTime.UtcNow;
            if (next != null) BeginState();
        }

        private void BeginState()
        {
            var st = state!;
            var art = w.Art!;
            if (pose != Pose.Stand) Set(Pose.Stand);
            foreach (var (which, _, canvas) in art.Props) canvas.Visibility = which == st.Id ? Visibility.Visible : Visibility.Collapsed;
            ShowMouth(st.Mouth);
            baseLids = st.Lids;
            // later tracks win over earlier ones for the same part, as on the page
            var tracks = new Dictionary<string, AvatarArt.Track>();
            foreach (var tr in st.Tracks) tracks[tr.Part + "." + tr.Prop] = tr;
            foreach (var tr in tracks.Values)
            {
                foreach (var (target, prop, rest, ofProp) in Targets(tr, art))
                {
                    driven.Add(new Driven(target, prop, rest, ofProp, tr));
                    if (freezeAt != null)
                    {
                        target.BeginAnimation(prop, null);
                        ((DependencyObject)target).SetValue(prop, AvatarArt.Eval(tr, freezeAt.Value, st.Dur));
                    }
                    else if (ofProp)
                    {
                        // a prop's parts are set where they start (or, with the animations off, where they look right
                        // held still): the prop appears in place rather than flying in from where it was last
                        target.BeginAnimation(prop, null);
                        ((DependencyObject)target).SetValue(prop, AvatarArt.Eval(tr, Lively ? 0 : st.Dur * 0.5, st.Dur));
                    }
                    else if (Lively)
                    {
                        double from = AvatarArt.Eval(tr, 0, st.Dur);
                        target.BeginAnimation(prop, new DoubleAnimation(from, Seconds(0.3)) { EasingFunction = Ease });
                    }
                }
            }
            if (freezeAt != null)
            {
                double t = freezeAt.Value, u = (t % (2 * st.BobSeconds)) / st.BobSeconds;
                w.Blink.BeginAnimation(ScaleTransform.ScaleYProperty, null);
                w.Blink.ScaleY = st.Lids;
                w.BodyShift.BeginAnimation(TranslateTransform.YProperty, null);
                w.BodyShift.Y = -st.BobRise * ((1 - Math.Cos(Math.PI * (u <= 1 ? u : 2 - u))) / 2);
                return;
            }
            if (!Lively) return;  // with the animations off he shows what he is doing and stays still
            Lids(st.Lids);
            Bob();
            if (!st.Blink) blink.Stop();
            settle ??= new DispatcherTimer { Interval = TimeSpan.FromSeconds(0.3) };
            settle.Stop();
            settle.Tick -= Settled;
            settle.Tick += Settled;
            settle.Start();
        }

        // He has eased into the state's first frame: from here the tracks go round.
        private void Settled(object? sender, EventArgs e)
        {
            settle?.Stop();
            Resume();
        }

        // The tracks, going round (from their start): when a state has settled in, and again when a performance
        // that cut in has finished, since it took over the parts it moved.
        private void Resume()
        {
            if (state == null || !Lively || (settle?.IsEnabled ?? false)) return;
            foreach (var d in driven) d.Target.BeginAnimation(d.Prop, Loop(d.Track, state.Dur));
            Lids(baseLids);
        }

        private void EndState()
        {
            settle?.Stop();
            foreach (var d in driven)
            {
                if (d.OfProp) { d.Target.BeginAnimation(d.Prop, null); ((DependencyObject)d.Target).SetValue(d.Prop, d.Rest); }
                else Hold(d.Target, d.Prop, d.Rest, 0.3);
            }
            bool was = state != null;
            driven.Clear();
            state = null;
            baseLids = 1;
            var art = w.Art;
            if (art != null)
            {
                foreach (var (_, _, canvas) in art.Props) canvas.Visibility = Visibility.Collapsed;
                art.Idle(Lively);  // his own parts' idle motion, which a state's track may have replaced
            }
            if (!was) return;
            // back to how his pose has him: the mouth, the lids, the bob, and the blink
            var held = pose;
            pose = Pose.Stand;
            Set(held);
            Mouth(held == Pose.Asleep);
            Lids(LidsFor(held));
            Bob();
            if (held == Pose.Stand || held == Pose.Sit) blink.Start();
        }

        // Show the one mouth a state asks for among the drawing's own, and none of the others.
        private void ShowMouth(string name)
        {
            var art = w.Art;
            if (art == null) return;
            foreach (var m in art.Mouths.Values) m.Visibility = Visibility.Collapsed;
            if (art.Mouths.TryGetValue(name, out var show) || art.Mouths.TryGetValue("neutral", out show)) show.Visibility = Visibility.Visible;
        }

        // What "Part.prop" of a track moves: the window's own transforms for the parts it has, and the drawing's
        // moving parts by name for the rest (the arms, a tail, a prop's pieces). x, y and a are a shift and a
        // turn, s, sx and sy a scale, o an opacity; the body's bob and the eyes' lids are not the tracks' (the
        // state has its own). Rest is the value the part has when nothing moves it.
        private (IAnimatable Target, DependencyProperty Prop, double Home, bool OfProp)[] Targets(AvatarArt.Track tr, AvatarArt art)
        {
            var found = new List<(IAnimatable, DependencyProperty, double, bool)>();
            void Add(IAnimatable t, DependencyProperty p, double rest, bool ofProp = false) => found.Add((t, p, rest, ofProp));
            void Scale(ScaleTransform s, bool ofProp = false)
            {
                if (tr.Prop == "sx" || tr.Prop == "s") Add(s, ScaleTransform.ScaleXProperty, 1, ofProp);
                if (tr.Prop == "sy" || tr.Prop == "s") Add(s, ScaleTransform.ScaleYProperty, 1, ofProp);
            }
            switch (tr.Part)
            {
                case "Root":
                    if (tr.Prop == "x") Add(w.RootLift, TranslateTransform.XProperty, 0);
                    else if (tr.Prop == "y") Add(w.RootLift, TranslateTransform.YProperty, 0);
                    else if (tr.Prop == "a") Add(w.RootLean, RotateTransform.AngleProperty, 0);
                    else Scale(w.RootSquash);
                    break;
                case "Body":
                    if (tr.Prop == "a") Add(w.BodySway, RotateTransform.AngleProperty, 0);
                    else if (tr.Prop == "x") Add(w.BodyShift, TranslateTransform.XProperty, 0);
                    break;
                case "LegL": case "LegR":
                {
                    bool left = tr.Part == "LegL";
                    if (tr.Prop == "y") Add(left ? w.LegLLift : w.LegRLift, TranslateTransform.YProperty, 0);
                    else if (tr.Prop == "x") Add(left ? w.LegLLift : w.LegRLift, TranslateTransform.XProperty, 0);
                    else if (tr.Prop == "a") Add(left ? w.LegLFold : w.LegRFold, RotateTransform.AngleProperty, 0);
                    break;
                }
                case "Pupils":
                    if (tr.Prop == "x") Add(w.PupilShift, TranslateTransform.XProperty, 0);
                    else if (tr.Prop == "y") Add(w.PupilShift, TranslateTransform.YProperty, 0);
                    break;
                case "Eyes": case "Tip": break;
                default:
                    foreach (var m in art.Moving.Where(x => x.Name == tr.Part))
                    {
                        bool ofProp = art.PropParts.Contains(tr.Part);
                        if (tr.Prop == "x") Add(m.T, TranslateTransform.XProperty, 0, ofProp);
                        else if (tr.Prop == "y") Add(m.T, TranslateTransform.YProperty, 0, ofProp);
                        else if (tr.Prop == "a") Add(m.R, RotateTransform.AngleProperty, 0, ofProp);
                        else if (tr.Prop == "o") Add(m.Outer, UIElement.OpacityProperty, 1, ofProp);
                        else Scale(m.S, ofProp);
                    }
                    break;
            }
            return found.ToArray();
        }

        // A track as a looping animation: the page's own function sampled thirty times a second, which is
        // the same curve whatever its kind (a run that wraps, a swell, or frames eased into each other).
        private static AnimationTimeline Loop(AvatarArt.Track tr, double stateDur)
        {
            double d = tr.Dur > 0 ? tr.Dur : stateDur;
            if (tr.Kind == 'f' && tr.Frames.Length <= 1)  // held still
                return new DoubleAnimation(AvatarArt.Eval(tr, 0, stateDur), Seconds(0.05));
            int n = Math.Max(2, (int)Math.Ceiling(d * 30));
            var loop = new DoubleAnimationUsingKeyFrames { Duration = Seconds(d), RepeatBehavior = RepeatBehavior.Forever };
            for (int i = 0; i <= n; i++)
            {
                double at = d * i / n, sample = i == n ? d - 1e-4 : at;  // (the last frame is the end of the round, not the start of the next)
                loop.KeyFrames.Add(new LinearDoubleKeyFrame(AvatarArt.Eval(tr, sample, stateDur), KeyTime.FromTimeSpan(Seconds(at))));
            }
            return loop;
        }

        // ------------------------------------------------------------ playing

        private void Play(Storyboard act, double wait)
        {
            running?.Stop(w);
            act.BeginTime = Seconds(wait);
            busyUntil = DateTime.UtcNow + Seconds(wait) + (act.Duration.HasTimeSpan ? act.Duration.TimeSpan : Seconds(2));
            blink.Stop(); // the eyes are the performance's while it runs
            act.Completed += (_, _) =>
            {
                running = null;
                busyUntil = DateTime.MinValue;
                if (pose == Pose.Stand || pose == Pose.Sit) blink.Start();
                Resume();
            };
            running = act;
            act.Begin(w, isControllable: true);
        }

        private Storyboard Build(Act act) => act switch
        {
            Act.Startle => Startle(),
            Act.Alert => Alert(),
            Act.Dance => Dance(),
            Act.Stretch => Stretch(),
            Act.LookAround => LookAround(),
            Act.Yawn => Yawn(),
            Act.Celebrate => Celebrate(big: false),
            Act.CelebrateBig => Celebrate(big: true),
            _ => Hop(),
        };

        // ------------------------------------------------------------ the performances

        // A little hop to say "look at me": the one he has always done.
        private Storyboard Hop()
        {
            var act = Board(0.68);
            Add(act, w.RootLift, TranslateTransform.YProperty, (-14, .17), (0, .34), (-14, .51), (0, .68));
            return act;
        }

        // Woken up: one startled bounce, leaning back from whatever it was.
        private Storyboard Startle()
        {
            var act = Board(0.34);
            Add(act, w.RootLift, TranslateTransform.YProperty, (-10, .12), (0, .3));
            Add(act, w.RootLean, RotateTransform.AngleProperty, (-7, .12), (0, .3));
            return act;
        }

        // There is a question waiting: twice as sharp as a hop, and a wobble.
        private Storyboard Alert()
        {
            var act = Board(0.56);
            Add(act, w.RootLift, TranslateTransform.YProperty, (-16, .12), (0, .24), (-16, .36), (0, .5));
            Add(act, w.RootLean, RotateTransform.AngleProperty, (6, .12), (-6, .3), (4, .42), (0, .56));
            return act;
        }

        // From foot to foot, three times, swaying into each step.
        private Storyboard Dance()
        {
            var act = Board(1.32);
            Add(act, w.LegLLift, TranslateTransform.YProperty,
                (-7, .11), (0, .22), (0, .44), (-7, .55), (0, .66), (0, .88), (-7, .99), (0, 1.1));
            Add(act, w.LegRLift, TranslateTransform.YProperty,
                (0, .22), (-7, .33), (0, .44), (0, .66), (-7, .77), (0, .88), (0, 1.1), (-7, 1.21), (0, 1.32));
            Add(act, w.BodySway, RotateTransform.AngleProperty,
                (4, .11), (-4, .33), (4, .55), (-4, .77), (4, .99), (0, 1.32));
            Add(act, w.RootLift, TranslateTransform.YProperty,
                (-2, .11), (0, .22), (-2, .33), (0, .44), (-2, .55), (0, .66),
                (-2, .77), (0, .88), (-2, .99), (0, 1.1), (-2, 1.21), (0, 1.32));
            Grin(act, 0, 1.32);
            return act;
        }

        // Up on tiptoe and back down, the way you do after sitting too long.
        private Storyboard Stretch()
        {
            var act = Board(0.95);
            Add(act, w.RootSquash, ScaleTransform.ScaleYProperty, (1.12, .4), (1, .95));
            Add(act, w.RootSquash, ScaleTransform.ScaleXProperty, (0.93, .4), (1, .95));
            Add(act, w.RootLift, TranslateTransform.YProperty, (-3, .4), (0, .95));
            return act;
        }

        // A look to one side, a look to the other, back to the front.
        private Storyboard LookAround()
        {
            var act = Board(2.2);
            Add(act, w.PupilShift, TranslateTransform.XProperty, (-3, .45), (-3, .95), (3, 1.4), (3, 1.9), (0, 2.2));
            Add(act, w.BodySway, RotateTransform.AngleProperty, (2, .45), (-2, 1.4), (0, 2.2));
            return act;
        }

        // Eyes screwed up, mouth open, a long breath in: the dozing fidget.
        private Storyboard Yawn()
        {
            var act = Board(1.2);
            Add(act, w.Blink, ScaleTransform.ScaleYProperty, (0.25, .3), (0.25, .8), (LidsFor(pose), 1.2));
            Add(act, w.RootSquash, ScaleTransform.ScaleYProperty, (1.06, .35), (1, 1.2));
            Add(act, w.RootLean, RotateTransform.AngleProperty, (-4, .35), (0, 1.2));
            Grin(act, .15, .95);
            return act;
        }

        // A section is finished. Gather, jump, wiggle in the air, land, and a
        // second smaller bounce out of sheer pleasure -- twice over for the big ones.
        private Storyboard Celebrate(bool big)
        {
            var act = Board(big ? 1.62 : 0.98);
            Add(act, w.RootSquash, ScaleTransform.ScaleYProperty, (0.84, .13), (1.08, .3), (1, .55));
            Add(act, w.RootSquash, ScaleTransform.ScaleXProperty, (1.14, .13), (0.94, .3), (1, .55));
            Add(act, w.LegLLift, TranslateTransform.YProperty, (-5, .3), (0, .58));
            Add(act, w.LegRLift, TranslateTransform.YProperty, (-5, .3), (0, .58));
            if (big)
            {
                Add(act, w.RootLift, TranslateTransform.YProperty,
                    (0, .13), (-24, .36), (0, .58), (-13, .76), (0, .94), (-20, 1.18), (0, 1.42), (0, 1.62));
                Add(act, w.RootLean, RotateTransform.AngleProperty,
                    (0, .13), (-10, .32), (10, .54), (-8, .78), (8, 1.02), (-5, 1.26), (0, 1.5));
            }
            else
            {
                Add(act, w.RootLift, TranslateTransform.YProperty, (0, .13), (-18, .36), (0, .58), (-8, .74), (0, .9));
                Add(act, w.RootLean, RotateTransform.AngleProperty, (0, .13), (-9, .32), (9, .56), (0, .8));
            }
            Grin(act, 0, big ? 1.62 : 0.98);
            return act;
        }

        // ------------------------------------------------------------ building

        private static Storyboard Board(double seconds) => new Storyboard { Duration = Seconds(seconds) };

        private static TimeSpan Seconds(double seconds) => TimeSpan.FromSeconds(seconds);

        // One number moved through a few values. The frames are (where, when in
        // seconds from the start of the act), and each eases into the next, so a
        // performance is a list of poses rather than a pile of animation objects.
        private static void Add(Storyboard act, DependencyObject part, DependencyProperty prop,
                               params (double To, double At)[] frames)
        {
            var track = new DoubleAnimationUsingKeyFrames();
            foreach (var f in frames)
                track.KeyFrames.Add(new EasingDoubleKeyFrame(f.To, KeyTime.FromTimeSpan(Seconds(f.At))) { EasingFunction = Ease });
            Storyboard.SetTarget(track, part);
            Storyboard.SetTargetProperty(track, new PropertyPath(prop));
            act.Children.Add(track);
        }

        // The grin, for as long as the act wants it: the ▽ goes away and comes
        // back on its own, because a track that stops rather than holds leaves the
        // property to whatever the pose set it to.
        private void Grin(Storyboard act, double from, double to)
        {
            Swap(act, w.MouthH, Visibility.Visible, from, to);
            Swap(act, w.MouthN, Visibility.Collapsed, from, to);
        }

        private static void Swap(Storyboard act, DependencyObject part, object during, double from, double to)
        {
            var track = new ObjectAnimationUsingKeyFrames { FillBehavior = FillBehavior.Stop, Duration = Seconds(to) };
            track.KeyFrames.Add(new DiscreteObjectKeyFrame(during, KeyTime.FromTimeSpan(Seconds(from))));
            Storyboard.SetTarget(track, part);
            Storyboard.SetTargetProperty(track, new PropertyPath(UIElement.VisibilityProperty));
            act.Children.Add(track);
        }
    }
}
