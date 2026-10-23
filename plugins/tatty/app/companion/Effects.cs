using System;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace TtCompanion
{
    // The stage around Tatty: confetti when a section is finished, a ring and
    // sparks while something waits for an answer, Z's while he sleeps.
    //
    // It is a window of its own rather than a bigger Tatty, because Tatty's
    // window is clickable all over -- that is how he is dragged -- and a stage
    // nearly three times his size would take a chunk of the desktop's corner out
    // of use. This one is click-through (Native.MakeClickThrough), so the mouse
    // never knows it is there.
    //
    // Everything is drawn in Tatty's own 104x120 coordinates plus the offset to
    // the middle of the stage, so the numbers here line up with
    // TattyWindow.xaml's: his head is at (52, 50) in both.
    internal sealed class Effects : Window
    {
        private const double StageW = 280, StageH = 240;
        private const double OffX = (StageW - 104) / 2, OffY = (StageH - 120) / 2;
        private const int MostParticles = 60; // a hard stop, so a storm can't fill the stage

        // The accent plus a few colours that are nobody's mode, for confetti.
        private static readonly Color[] Festive =
        {
            Color.FromRgb(0xE5, 0xA3, 0x2B), Color.FromRgb(0x4C, 0xAF, 0x50), Color.FromRgb(0xE0, 0x52, 0x63),
            Color.FromRgb(0x7D, 0x5B, 0xBD), Color.FromRgb(0x3B, 0x9B, 0xD6), Color.FromRgb(0xF2, 0xC9, 0x4C),
        };

        private readonly Canvas stage = new Canvas();
        private readonly DispatcherTimer asking = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2.5) };
        private readonly DispatcherTimer sleeping = new DispatcherTimer { Interval = TimeSpan.FromSeconds(3.6) };
        private readonly Random random = new Random();

        public Effects()
        {
            Title = "Tatty";
            Width = StageW;
            Height = StageH;
            WindowStyle = WindowStyle.None;
            AllowsTransparency = true;
            Background = Brushes.Transparent;
            Topmost = true;
            ShowInTaskbar = false;
            ShowActivated = false;
            ResizeMode = ResizeMode.NoResize;
            IsHitTestVisible = false;
            Focusable = false;
            Content = stage;
            SourceInitialized += (_, _) => Native.MakeClickThrough(this);
            asking.Tick += (_, _) => Pulse();
            sleeping.Tick += (_, _) => Snore();
        }

        // The person's own choice, from the tray menu.
        public bool Enabled { get; set; } = true;

        // Over the part of Tatty that is drawn, so his middle is the stage's
        // middle whichever way his window is padded.
        public void PlaceOn(Window tatty)
        {
            double s = Native.Scale(tatty);
            var t = Native.Rect(tatty);
            int cx = t.Left + t.Width / 2;
            int cy = (t.Top + (int)(TattyWindow.TopInset * s) + t.Bottom - (int)(TattyWindow.BottomInset * s)) / 2;
            int w = (int)(StageW * s), h = (int)(StageH * s);
            Native.SetBounds(this, cx - w / 2, cy - h / 2, w, h);
        }

        // ------------------------------------------------------------ what it shows

        // A section is finished. Big for a plan signed off or a build complete.
        public void Confetti(bool big)
        {
            int count = big ? 34 : 18;
            if (!Ready(count)) return;
            for (int i = 0; i < count; i++) Flake(big);
        }

        // Something waits for an answer: a ring off him and a few sparks, again
        // every couple of seconds until it is answered.
        public void Asking(bool on)
        {
            if (!on) { asking.Stop(); return; }
            if (asking.IsEnabled) return;
            Pulse();
            asking.Start();
        }

        // Asleep: Z's drifting off up and away, over and over.
        public void Sleeping(bool on)
        {
            if (!on) { sleeping.Stop(); return; }
            if (sleeping.IsEnabled) return;
            Snore();
            sleeping.Start();
        }

        // Tatty has gone: nothing to be the stage for.
        public void Clear()
        {
            asking.Stop();
            sleeping.Stop();
            stage.Children.Clear();
            Hide();
        }

        // ------------------------------------------------------------ the particles

        private void Flake(bool big)
        {
            double life = 1.3 + random.NextDouble() * (big ? 0.9 : 0.5);
            var flake = new Rectangle
            {
                Width = 5 + random.NextDouble() * 4,
                Height = 3 + random.NextDouble() * 2,
                RadiusX = 1,
                RadiusY = 1,
                Fill = new SolidColorBrush(Festive[random.Next(Festive.Length)]),
                Opacity = 0,
            };
            var spin = new RotateTransform { CenterX = flake.Width / 2, CenterY = flake.Height / 2 };
            var move = new TranslateTransform();
            flake.RenderTransform = new TransformGroup { Children = { spin, move } };
            Put(flake, OffX + 52 + Spread(26), OffY + 10 + Spread(8));

            move.BeginAnimation(TranslateTransform.XProperty, Glide(Spread(big ? 115 : 80), life));
            move.BeginAnimation(TranslateTransform.YProperty,
                                Sweep(Arc(-(55 + random.NextDouble() * 75), 120 + random.NextDouble() * 50, life), flake));
            spin.BeginAnimation(RotateTransform.AngleProperty, Glide(Spread(1080), life));
            flake.BeginAnimation(UIElement.OpacityProperty, Life(life, 0.75));
        }

        private void Pulse()
        {
            if (!Ready(7)) return;
            const double size = 118;
            var ring = new Ellipse
            {
                Width = size, Height = size, Opacity = 0,
                Stroke = Accent, StrokeThickness = 3, Fill = null,
            };
            var grow = new ScaleTransform { CenterX = size / 2, CenterY = size / 2, ScaleX = 0.35, ScaleY = 0.35 };
            ring.RenderTransform = grow;
            Put(ring, OffX + 52 - size / 2, OffY + 50 - size / 2);
            grow.BeginAnimation(ScaleTransform.ScaleXProperty, Glide(1.35, 1.1, EaseOut));
            grow.BeginAnimation(ScaleTransform.ScaleYProperty, Sweep(Glide(1.35, 1.1, EaseOut), ring));
            ring.BeginAnimation(UIElement.OpacityProperty, Life(1.1, 0.1, 0.65));

            for (int i = 0; i < 5; i++) Spark();
        }

        private void Spark()
        {
            double life = 1 + random.NextDouble() * 0.6;
            var spark = new Ellipse { Width = 5, Height = 5, Fill = Accent, Opacity = 0 };
            var move = new TranslateTransform();
            spark.RenderTransform = move;
            Put(spark, OffX + 20 + random.NextDouble() * 64, OffY + 88);
            move.BeginAnimation(TranslateTransform.XProperty, Glide(Spread(14), life));
            move.BeginAnimation(TranslateTransform.YProperty,
                                Sweep(Glide(-(50 + random.NextDouble() * 55), life, EaseOut), spark));
            spark.BeginAnimation(UIElement.OpacityProperty, Life(life, 0.9));
        }

        private void Snore()
        {
            if (!Ready(3)) return;
            for (int i = 0; i < 3; i++)
            {
                double life = 2.4, wait = i * 0.55;
                var z = new TextBlock
                {
                    Text = "Z", FontSize = 13 + i * 4, FontWeight = FontWeights.Bold,
                    Foreground = Accent, Opacity = 0,
                };
                var move = new TranslateTransform();
                z.RenderTransform = move;
                Put(z, OffX + 72, OffY + 26);
                move.BeginAnimation(TranslateTransform.XProperty, After(Glide(26 + random.NextDouble() * 12, life), wait));
                move.BeginAnimation(TranslateTransform.YProperty,
                                    Sweep(After(Glide(-(28 + i * 9), life), wait), z));
                z.BeginAnimation(UIElement.OpacityProperty, After(Life(life, 0.55), wait));
            }
        }

        // ------------------------------------------------------------ the stage

        private static Brush Accent =>
            Application.Current?.Resources["TtAccent"] as Brush ?? Brushes.SteelBlue;

        // Effects off, nothing moving at all (Motion), or the stage already full.
        private bool Ready(int wanting) =>
            Enabled && Motion.On && stage.Children.Count + wanting <= MostParticles;

        private void Put(UIElement shape, double x, double y)
        {
            Canvas.SetLeft(shape, x);
            Canvas.SetTop(shape, y);
            stage.Children.Add(shape);
            if (IsVisible) return;
            Show();
            Native.KeepOnTop(this, true); // in front of Tatty, who is topmost too
        }

        // A particle takes itself off the stage when it is done, and the last one
        // out puts the stage away -- unless something is still being emitted into
        // it. This hands back the animation to begin, because a clock only takes
        // the handlers its timeline had before it was started: attached after,
        // nothing is ever swept up and the stage stays on screen for good.
        private T Sweep<T>(T last, UIElement shape) where T : AnimationTimeline
        {
            last.Completed += (_, _) =>
            {
                stage.Children.Remove(shape);
                if (stage.Children.Count == 0 && !asking.IsEnabled && !sleeping.IsEnabled) Hide();
            };
            return last;
        }

        // ------------------------------------------------------------ small animations

        private static readonly IEasingFunction EaseOut = new QuadraticEase { EasingMode = EasingMode.EaseOut };

        private static TimeSpan Secs(double seconds) => TimeSpan.FromSeconds(seconds);

        // Random, either way: a spread of ±reach.
        private double Spread(double reach) => (random.NextDouble() * 2 - 1) * reach;

        private static DoubleAnimation Glide(double to, double seconds, IEasingFunction? ease = null) =>
            new DoubleAnimation(to, Secs(seconds)) { EasingFunction = ease };

        // Up and then down again, as a thrown thing goes.
        private static DoubleAnimationUsingKeyFrames Arc(double up, double down, double seconds)
        {
            var arc = new DoubleAnimationUsingKeyFrames();
            arc.KeyFrames.Add(new EasingDoubleKeyFrame(up, KeyTime.FromTimeSpan(Secs(seconds * 0.35)))
                              { EasingFunction = EaseOut });
            arc.KeyFrames.Add(new EasingDoubleKeyFrame(down, KeyTime.FromTimeSpan(Secs(seconds)))
                              { EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseIn } });
            return arc;
        }

        // In, hold, out: a particle's whole visible life, so none of them pops.
        private static DoubleAnimationUsingKeyFrames Life(double seconds, double stay, double peak = 1)
        {
            var life = new DoubleAnimationUsingKeyFrames();
            life.KeyFrames.Add(new LinearDoubleKeyFrame(peak, KeyTime.FromTimeSpan(Secs(seconds * 0.1))));
            life.KeyFrames.Add(new LinearDoubleKeyFrame(peak, KeyTime.FromTimeSpan(Secs(seconds * stay))));
            life.KeyFrames.Add(new LinearDoubleKeyFrame(0, KeyTime.FromTimeSpan(Secs(seconds))));
            return life;
        }

        private static T After<T>(T animation, double seconds) where T : AnimationTimeline
        {
            animation.BeginTime = Secs(seconds);
            return animation;
        }
    }
}
