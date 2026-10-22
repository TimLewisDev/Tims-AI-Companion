using System;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media.Animation;
using System.Windows.Threading;

namespace TtCompanion
{
    // Tatty on the desktop: bobs, blinks, shows a badge when something waits for
    // an answer. A click toggles the bubble; a drag moves him (and the bubble).
    public partial class TattyWindow : Window
    {
        public event Action? Clicked;
        public event Action? Moved;

        private readonly DispatcherTimer blinkTimer = new DispatcherTimer();
        private readonly Random random = new Random();

        public TattyWindow()
        {
            InitializeComponent();
            SourceInitialized += (_, _) => Native.MakeToolWindow(this, noActivate: true);
            Loaded += (_, _) => { StartBob(); StartBlinking(); };
            MouseLeftButtonDown += OnMouseDown;
        }

        public bool HasBadge
        {
            set => Badge.Visibility = value ? Visibility.Visible : Visibility.Collapsed;
        }

        private void StartBob()
        {
            var bob = new DoubleAnimation(0, -4, TimeSpan.FromSeconds(1.6))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            };
            Bob.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, bob);
        }

        private void StartBlinking()
        {
            blinkTimer.Tick += (_, _) =>
            {
                var blink = new DoubleAnimation(1, 0.1, TimeSpan.FromMilliseconds(90)) { AutoReverse = true };
                Blink.BeginAnimation(System.Windows.Media.ScaleTransform.ScaleYProperty, blink);
                blinkTimer.Interval = TimeSpan.FromSeconds(3 + random.NextDouble() * 4);
            };
            blinkTimer.Interval = TimeSpan.FromSeconds(2);
            blinkTimer.Start();
        }

        // A little hop to say "look at me".
        public void Hop()
        {
            var hop = new DoubleAnimation(0, -14, TimeSpan.FromMilliseconds(160))
            {
                AutoReverse = true,
                RepeatBehavior = new RepeatBehavior(2),
                EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut },
            };
            hop.Completed += (_, _) => StartBob();
            Bob.BeginAnimation(System.Windows.Media.TranslateTransform.YProperty, hop);
        }

        private void OnMouseDown(object sender, MouseButtonEventArgs e)
        {
            var before = Native.Rect(this);
            try { DragMove(); } catch (InvalidOperationException) { return; }
            var after = Native.Rect(this);
            if (Math.Abs(after.Left - before.Left) < 4 && Math.Abs(after.Top - before.Top) < 4) Clicked?.Invoke();
            else Moved?.Invoke();
        }
    }
}
