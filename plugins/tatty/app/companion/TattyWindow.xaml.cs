using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

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
        // from these rather than from the window's edges. (The top one is deep enough for the
        // tallest hats in the shop.)
        public const double TopInset = 44, BottomInset = 12;

        public event Action? Clicked;
        public event Action? Moved;
        public event Action? RightClicked;

        private readonly Avatar avatar;

        // The mouths Avatar.cs swaps between: the drawing's own, until an avatar from the
        // shop brings its own (Apply).
        internal UIElement MouthN, MouthH, MouthF;
        private Canvas? backBody; // what he wears on his back: behind his legs, riding with his body
        private AvatarArt? art;
        private readonly List<UIElement> rootProps = new(); // props riding with all of him (the notepad), in Robot

        // The drawing now on him, for Avatar.cs to find the parts, props and states of.
        internal AvatarArt? Art => art;
        private int number;

        public TattyWindow()
        {
            InitializeComponent();
            MouthN = MouthNeutral;
            MouthH = MouthHappy;
            MouthF = MouthFlat;
            avatar = new Avatar(this);
            // As he was last time, from the first frame (the page says again once it has loaded).
            var saved = AvatarArt.Saved();
            var last = saved == null ? null : AvatarArt.Read(saved);
            if (last != null) Apply(last);
            SourceInitialized += (_, _) => Native.MakeToolWindow(this, noActivate: true);
            Loaded += (_, _) => avatar.Start();
            MouseLeftButtonDown += OnMouseDown;
            MouseEnter += (_, _) => avatar.Poke();
            // His own menu, the same one the tray icon has: everything about him
            // is where he is, rather than down in the corner of the screen.
            MouseRightButtonUp += (_, e) => { e.Handled = true; avatar.Poke(); RightClicked?.Invoke(); };
        }

        // The number he wears: the project this Tatty is for, or none (the Hub's Tatty has no
        // project, and so no number). It sits where it suits the avatar (Apply); two digits get a
        // smaller type, and past 99 it says so rather than overflowing.
        public void SetNumber(int number)
        {
            this.number = number;
            NumTag.Visibility = number > 0 ? Visibility.Visible : Visibility.Collapsed;
            NumberText.Text = number > 99 ? "99+" : number.ToString();
            PlaceNumber();
        }

        // The number's type and place, from the avatar's badge (or the plate of today's drawing).
        private void PlaceNumber()
        {
            double size = (art?.NumberSize ?? 7) * (number > 99 ? 0.65 : number > 9 ? 0.8 : 1);
            var at = art?.NumberAt ?? new Point(32, 73.6);
            NumberText.FontSize = size;
            Canvas.SetLeft(NumberText, at.X - NumberText.Width / 2);
            Canvas.SetTop(NumberText, at.Y - size * 1.05); // its baseline on the badge's (Segoe UI's ascent)
        }

        // What he looks like now, from the page (avatar.js's bake): the avatar chosen in the
        // shop, in what he wears. A description that doesn't read changes nothing.
        public void SetAvatar(string? text)
        {
            if (string.IsNullOrEmpty(text)) return;
            var next = AvatarArt.Read(text);
            if (next == null) return;
            Apply(next);
            AvatarArt.Save(text);
        }

        // The new drawing goes into the canvases TattyWindow.xaml names, and every pivot moves
        // to the avatar's own, so Avatar.cs moves him exactly as before. The eyes, the pupils,
        // the project number's badge (with the number, which the window writes) and the "!"
        // badge stay the window's own elements, placed where this avatar has them.
        private void Apply(AvatarArt a)
        {
            art?.Idle(false);
            art = a;
            RootSquash.CenterX = RootLean.CenterX = a.Root.X;
            RootSquash.CenterY = RootLean.CenterY = a.Root.Y;
            LegLFold.CenterX = a.LegLPivot.X; LegLFold.CenterY = a.LegLPivot.Y;
            LegRFold.CenterX = a.LegRPivot.X; LegRFold.CenterY = a.LegRPivot.Y;
            BodySway.CenterX = a.BodyPivot.X; BodySway.CenterY = a.BodyPivot.Y;
            Blink.CenterY = a.EyesPivot.Y;

            if (backBody == null)
            {
                backBody = new Canvas { RenderTransform = Body.RenderTransform };
                Robot.Children.Insert(0, backBody);
            }
            Fill(backBody, a.Back);
            Fill(LegL, a.LegL);
            Fill(LegR, a.LegR);

            // The window's own elements may sit deep in the last drawing (the number's badge
            // inside a wrapper, or in a leg), not just in Body: take each out wherever it is, or
            // putting it into the new drawing throws and leaves him half drawn.
            foreach (var own in new FrameworkElement[] { Eyes, Pupils, NumTag, NumberText, Badge }) Detach(own);
            Body.Children.Clear();
            Eyes.Children.Clear();
            Fill(Pupils, a.Pupils);
            foreach (var e in a.Eyes) Eyes.Children.Add(e is AvatarArt.PupilsMark ? Pupils : e);
            if (!a.Eyes.Any(e => e is AvatarArt.PupilsMark)) Eyes.Children.Add(Pupils);
            NumTag.Children.Clear();
            foreach (var t in a.NumTag) NumTag.Children.Add(t);
            NumTag.Children.Add(NumberText);
            NumberText.Foreground = a.NumberPaint ?? Brushes.White;

            foreach (var e in a.Body) Body.Children.Add(e);
            if (!Replace(a.EyesSlot, Eyes)) Body.Children.Add(Eyes);
            if (!Replace(a.NumSlot, NumTag)) Body.Children.Add(NumTag);
            // The working states' props, hidden until Avatar.cs shows them: behind him, on his body (sway and
            // bob with it, in front of his face), or on all of him (over his body, with the lean and squash).
            PropsBack.Children.Clear();
            foreach (var old in rootProps) Robot.Children.Remove(old);
            rootProps.Clear();
            foreach (var (_, layer, canvas) in a.Props)
            {
                if (layer == "back") PropsBack.Children.Add(canvas);
                else if (layer == "body") Body.Children.Add(canvas);
                else if (layer == "root") { Robot.Children.Add(canvas); rootProps.Add(canvas); }
            }
            Canvas.SetLeft(Badge, a.BadgeAt.X - 11);
            Canvas.SetTop(Badge, a.BadgeAt.Y - 11);
            Body.Children.Add(Badge);

            PlaceNumber();
            MouthN = a.Mouths.GetValueOrDefault("neutral") ?? new Canvas();
            MouthH = a.Mouths.GetValueOrDefault("happy") ?? new Canvas();
            MouthF = a.Mouths.GetValueOrDefault("flat") ?? new Canvas();
            avatar.Refresh();
            a.Idle(Motion.On);
        }

        private static void Fill(Panel panel, IEnumerable<UIElement> kids)
        {
            panel.Children.Clear();
            foreach (var k in kids) panel.Children.Add(k);
        }

        private static void Detach(FrameworkElement e)
        {
            if (e.Parent is Panel p) p.Children.Remove(e);
        }

        // Put one of the window's own elements where the drawing kept a place for it.
        private static bool Replace(Panel? slot, UIElement real)
        {
            if (slot?.Parent is not Panel parent) return false;
            int at = parent.Children.IndexOf(slot);
            parent.Children.RemoveAt(at);
            parent.Children.Insert(at, real);
            return true;
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

        // For the render check: the drawing from a file, not kept as his look and not the saved one.
        internal bool ApplyForRender(string text)
        {
            var a = AvatarArt.Read(text);
            if (a == null) return false;
            Apply(a);
            return true;
        }

        internal void SnapState(string id, double t) => avatar.SnapState(id, t);
        internal double StateDuration(string id) => art != null && art.States.TryGetValue(id, out var s) ? s.Dur : 2;

        // What the session is doing (the server's "avatar" event): thinking, reading, writing, running,
        // delegating, needs, oops, or idle / null for none. He plays it until it changes.
        public void SetState(string? id) => avatar.SetState(id);

        // Do this one now, because somebody picked it off his menu to watch it.
        internal void Preview(Act act) => avatar.Preview(act);
        internal void Preview(Pose pose) => avatar.Preview(pose);
        internal void PreviewState(string id) => avatar.PreviewState(id);
        internal IEnumerable<string> StateIds => art?.States.Keys ?? Enumerable.Empty<string>();

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
