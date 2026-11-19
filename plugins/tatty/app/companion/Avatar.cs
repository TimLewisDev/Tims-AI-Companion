using System;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace TtCompanion
{
    // What Tatty can do on his own: one-shot performances.
    internal enum Act { Hop, Startle, Alert, Dance, Stretch, LookAround, Celebrate, CelebrateBig }

    // ... and how he holds himself between them.
    internal enum Pose { Stand, Sit, Asleep }

    // Tatty's animation. He bobs and blinks as he always did; left alone while the
    // project's sessions work he fidgets -- a look about, a dance from foot to
    // foot, a sit down. Asleep means the project is idle: once no session has
    // anything running (Follow("idle"), from App.xaml.cs's Doing()) he nods off a
    // few seconds later, and wakes with a start when work begins again. A hand
    // reaching for him wakes him too (Poke), for a few seconds; news from the
    // server only resets the fidget clock (Stir), so it doesn't keep waking him
    // while nothing runs.
    //
    // A question waiting outranks all of it (Follow("needs")): he stands, and
    // nothing plays over the alert -- no fidget, no sitting, no sleep, no
    // celebration -- until every question is answered.
    //
    // Everything here animates the transforms TattyWindow.xaml names, so the
    // drawing stays in the XAML and the movement stays here. Two properties are
    // owned outright to keep the clocks from fighting over them: BodyShift.Y is
    // the idle bob's and Blink.ScaleY the blink's and the poses', so a
    // performance uses the root transforms, the legs and the pupils instead.
    internal sealed class Avatar
    {
        // How long he is left alone before he fidgets, the gap between fidgets,
        // and how long he stays awake once the project goes idle (or after a
        // hand wakes him). TATTY_ANIM_FAST divides them all.
        private const double IdleAfter = 45, FidgetGap = 20, NodOff = 8;
        private const double SitDrop = 12, SitFold = 72; // how far he sinks and how far his legs splay

        private static readonly IEasingFunction Ease = new SineEase { EasingMode = EasingMode.EaseInOut };

        private readonly TattyWindow w;
        private readonly DispatcherTimer blink = new DispatcherTimer();
        private readonly DispatcherTimer ladder = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        private readonly Random random = new Random();
        private readonly double hurry = Environment.GetEnvironmentVariable("TATTY_ANIM_FAST") == "1" ? 9 : 1;

        private Storyboard? running;
        private DateTime busyUntil, poked, nextFidget, sitUntil, awakeUntil;
        private Pose pose = Pose.Stand;
        private bool projectIdle, asking, holding;

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

        // What the project is doing, as App.xaml.cs's Doing() names it: "idle"
        // (nothing running anywhere), "needs" (a question waiting) or one of the
        // working states. Only the change between those three matters here:
        // idle sends him to sleep on the ladder's next ticks, and anything else
        // wakes him; a question also stands him up and keeps him standing.
        public void Follow(string state)
        {
            bool idle = state == "idle", needs = state == "needs";
            if (idle == projectIdle && needs == asking) return;
            projectIdle = idle;
            asking = needs;
            holding = false;
            if (idle) StayAwake(DateTime.UtcNow);
            else Wake();
        }

        // Someone reached for him (a hover, a click, a drag), or he was brought
        // out: wake up, stand up, and start counting the quiet again. While the
        // project is idle he nods off again a few seconds later.
        public void Poke()
        {
            var now = DateTime.UtcNow;
            poked = now;
            holding = false;
            StayAwake(now);
            Wake();
        }

        // News from the server: the fidget clock starts again and a sit ends,
        // but sleep is left alone -- the project's state ends it (Follow), so the
        // odd event while nothing runs doesn't keep waking him up.
        public void Stir()
        {
            poked = DateTime.UtcNow;
            if (pose == Pose.Sit && !holding && !projectIdle) Set(Pose.Stand);
        }

        private void Wake()
        {
            if (pose == Pose.Stand) return;
            bool sleeping = pose == Pose.Asleep;
            Set(Pose.Stand);
            if (sleeping) Perform(Act.Startle);
        }

        private void StayAwake(DateTime from)
        {
            var until = from + Seconds(NodOff / hurry);
            if (until > awakeUntil) awakeUntil = until;
        }

        // One performance at a time. A fidget waits its turn and is dropped if it
        // misses it; the two that are the whole point -- a question, a milestone --
        // cut in. While a question waits, the alert is the only one he does.
        public void Perform(Act act)
        {
            if (asking && act != Act.Alert) return;
            Run(act, cutsIn: act == Act.Alert || act == Act.Celebrate || act == Act.CelebrateBig);
        }

        // One asked for by name, from his own menu. It cuts in, because somebody
        // who has just picked a performance off a menu should see that one and
        // not whatever he happened to be doing, and the quiet starts again, so
        // he doesn't wander off into a fidget while it is being watched. Not
        // over a waiting question, though (the menu greys these out then).
        public void Preview(Act act)
        {
            if (asking && act != Act.Alert) return;
            poked = DateTime.UtcNow;
            StayAwake(poked);
            Run(act, cutsIn: true);
        }

        // A pose held for as long as it is wanted: the ladder lets him be, so
        // nothing stands him up or sends him to sleep until something really
        // happens (a hand reaching for him, or the project starting or stopping
        // work, or a question arriving).
        public void Preview(Pose held)
        {
            if (asking && held != Pose.Stand) return;
            poked = DateTime.UtcNow;
            holding = true;
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
        private static bool Standing(Act act) => act != Act.LookAround;

        private double Quiet => (DateTime.UtcNow - poked).TotalSeconds * hurry;

        // ------------------------------------------------------------ the ladder

        private void Tick()
        {
            if (!Lively || holding) return;
            // A question waiting: he stands and asks (Follow stood him up), and that is all.
            if (asking) return;
            var now = DateTime.UtcNow;
            // Nothing running in the project: asleep, once he has finished whatever
            // he was doing and the few seconds' grace are up.
            if (projectIdle)
            {
                if (pose != Pose.Asleep && now >= awakeUntil && now >= busyUntil) Set(Pose.Asleep);
                return;
            }
            if (pose == Pose.Sit && now >= sitUntil) Set(Pose.Stand);

            if (Quiet < IdleAfter || now < busyUntil || now < nextFidget) return;
            nextFidget = now + Seconds((FidgetGap + random.NextDouble() * FidgetGap) / hurry);
            Fidget();
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

        private static double LidsFor(Pose p) => p == Pose.Asleep ? 0.08 : 1;

        // The idle bob: slower and shallower sat down, and slower still asleep. It owns
        // BodyShift.Y, so it survives every performance underneath it.
        private void Bob()
        {
            (double rise, double seconds) = pose switch
            {
                Pose.Sit => (3.0, 2.2),
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
                new DoubleAnimation(1, 0.1, TimeSpan.FromMilliseconds(90)) { AutoReverse = true });
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

        // A new drawing (an avatar from the shop, TattyWindow.Apply): its mouths take up the pose.
        public void Refresh() => Mouth(pose == Pose.Asleep);

        // A value animated to and then kept: the pose is where he stays until
        // something changes it, so these hold their end rather than snapping back.
        private static void Hold(IAnimatable part, DependencyProperty prop, double to, double seconds) =>
            part.BeginAnimation(prop, new DoubleAnimation(to, Seconds(seconds)) { EasingFunction = Ease });

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
