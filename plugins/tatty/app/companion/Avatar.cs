using System;
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
        // cut in, and stand him up first if he was sitting.
        public void Perform(Act act)
        {
            if (!Lively) return;
            bool matters = act == Act.Alert || act == Act.Celebrate || act == Act.CelebrateBig;
            if (DateTime.UtcNow < busyUntil && !matters) return;
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
            if (!Lively) return;
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
            (double rise, double seconds) = pose switch
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
            w.MouthFlat.Visibility = asleep ? Visibility.Visible : Visibility.Collapsed;
            w.MouthNeutral.Visibility = asleep ? Visibility.Collapsed : Visibility.Visible;
        }

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
            Swap(act, w.MouthHappy, Visibility.Visible, from, to);
            Swap(act, w.MouthNeutral, Visibility.Collapsed, from, to);
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
