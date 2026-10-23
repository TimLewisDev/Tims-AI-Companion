using System;
using System.Windows;
using System.Windows.Input;

namespace TtCompanion
{
    // Tatty on the desktop: he lives his own small life (Avatar.cs), and shows a
    // badge when something waits for an answer. A click toggles the bubble; a drag
    // moves him (and the bubble). Reaching for him counts as something happening,
    // so he is awake by the time the mouse arrives.
    public partial class TattyWindow : Window
    {
        // The strips of empty window above and below the drawing, in WPF units:
        // room to jump up into and to sit down into, since anything that leaves
        // the window is clipped. Whatever places something against Tatty measures
        // from these rather than from the window's edges.
        public const double TopInset = 24, BottomInset = 12;

        public event Action? Clicked;
        public event Action? Moved;
        public event Action? RightClicked;

        private readonly Avatar avatar;

        public TattyWindow()
        {
            InitializeComponent();
            avatar = new Avatar(this);
            SourceInitialized += (_, _) => Native.MakeToolWindow(this, noActivate: true);
            Loaded += (_, _) => avatar.Start();
            MouseLeftButtonDown += OnMouseDown;
            MouseEnter += (_, _) => avatar.Poke();
            // His own menu, the same one the tray icon has: everything about him
            // is where he is, rather than down in the corner of the screen.
            MouseRightButtonUp += (_, e) => { e.Handled = true; avatar.Poke(); RightClicked?.Invoke(); };
        }

        public bool HasBadge
        {
            set => Badge.Visibility = value ? Visibility.Visible : Visibility.Collapsed;
        }

        // What Tatty is doing, for whatever wants to join in: the Zzz's follow his
        // pose, and the confetti follows a celebration.
        internal Pose Pose => avatar.Pose;
        internal event Action<Pose>? PoseChanged
        {
            add => avatar.PoseChanged += value;
            remove => avatar.PoseChanged -= value;
        }

        // Something happened: wake up and stand up.
        public void Poke() => avatar.Poke();

        // A little hop to say "look at me".
        public void Hop() => avatar.Perform(Act.Hop);

        // There is a question waiting.
        public void Alert() => avatar.Perform(Act.Alert);

        // A section is finished; big for a plan signed off or a build complete.
        public void Celebrate(bool big) => avatar.Perform(big ? Act.CelebrateBig : Act.Celebrate);

        // Do this one now, because somebody picked it off his menu to watch it.
        internal void Preview(Act act) => avatar.Preview(act);
        internal void Preview(Pose pose) => avatar.Preview(pose);

        private void OnMouseDown(object sender, MouseButtonEventArgs e)
        {
            avatar.Poke();
            var before = Native.Rect(this);
            try { DragMove(); } catch (InvalidOperationException) { return; }
            var after = Native.Rect(this);
            if (Math.Abs(after.Left - before.Left) < 4 && Math.Abs(after.Top - before.Top) < 4) Clicked?.Invoke();
            else Moved?.Invoke();
        }
    }
}
