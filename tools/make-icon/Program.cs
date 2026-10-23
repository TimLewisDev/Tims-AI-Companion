using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

// Tatty's face as files, so the shell can show it when the app isn't running.
// The geometry is TattyWindow.xaml's head (antenna, rounded head, ◉ ◉ eyes,
// ▽ mouth) in the engineering accent; he is drawn without his legs, as in the
// plugin icon, so the face fills the square.
//
// usage: make-icon <assets dir> <plugin icon.png>
internal static class Program
{
    private static readonly int[] Sizes = { 16, 24, 32, 48, 64, 128, 256 };

    // The drawing is 68 x 76 units (head 18..86, antenna ball from y 4 to 80).
    private const float DrawingW = 68, DrawingH = 76, OriginX = 18, OriginY = 4;

    private static int Main(string[] args)
    {
        if (args.Length != 2) { Console.Error.WriteLine("usage: make-icon <assets dir> <plugin icon.png>"); return 2; }
        Directory.CreateDirectory(args[0]);

        var pngs = new List<(int Size, byte[] Data)>();
        foreach (int size in Sizes)
        {
            using var bmp = Draw(size, background: null);
            using var ms = new MemoryStream();
            bmp.Save(ms, ImageFormat.Png);
            pngs.Add((size, ms.ToArray()));
        }
        File.WriteAllBytes(Path.Combine(args[0], "tatty.ico"), PackIco(pngs));

        // The marketplace icon keeps the soft background it always had.
        using (var plugin = Draw(512, Color.FromArgb(0xF7, 0xF6, 0xF2)))
            plugin.Save(args[1], ImageFormat.Png);

        Console.WriteLine($"wrote {Path.Combine(args[0], "tatty.ico")} ({Sizes.Length} sizes) and {args[1]}");
        return 0;
    }

    private static Bitmap Draw(int size, Color? background)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        if (background is Color back) g.Clear(back); else g.Clear(Color.Transparent);

        // Fit the drawing in the square with a margin; small sizes get less
        // margin and heavier lines, because a 16 px face is mostly outline.
        float margin = size >= 128 ? 0.07f : size >= 48 ? 0.05f : 0.02f;
        float scale = size * (1 - 2 * margin) / DrawingH;
        float left = (size - DrawingW * scale) / 2, top = size * margin;
        float bold = size >= 128 ? 1f : size >= 48 ? 1.25f : size >= 32 ? 1.6f : 2.0f;
        PointF P(float x, float y) => new PointF(left + (x - OriginX) * scale, top + (y - OriginY) * scale);
        RectangleF R(float x, float y, float w, float h)
        {
            var p = P(x, y);
            return new RectangleF(p.X, p.Y, w * scale, h * scale);
        }

        var accent = Color.FromArgb(0x3B, 0x6E, 0xA8);
        using var line = new Pen(accent, 3 * scale * bold) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        using var eyeRing = new Pen(accent, 2.5f * scale * bold);
        using var accentBrush = new SolidBrush(accent);
        using var faceBrush = new SolidBrush(Color.FromArgb(0xFD, 0xFC, 0xF9));
        using var pupilBrush = new SolidBrush(Color.FromArgb(0x1F, 0x23, 0x28));

        // antenna
        g.DrawLine(line, P(52, 10), P(52, 24));
        g.FillEllipse(accentBrush, R(47 - (bold - 1) * 2, 4 - (bold - 1) * 2, 10 + (bold - 1) * 4, 10 + (bold - 1) * 4));

        // head
        using (var head = RoundedRect(R(18, 24, 68, 56), 12 * scale))
        {
            g.FillPath(faceBrush, head);
            g.DrawPath(line, head);
        }

        // eyes: ring and pupil. At the smallest sizes the ring would swallow
        // the pupil, so the ring is dropped for a solid dark eye.
        foreach (float ex in new[] { 30f, 56f })
        {
            if (size <= 24)
            {
                g.FillEllipse(pupilBrush, R(ex + 1, 40, 16, 16));
                continue;
            }
            g.DrawEllipse(eyeRing, R(ex, 39, 18, 18));
            g.FillEllipse(pupilBrush, R(ex + 5, 44, 8, 8));
        }

        // mouth: ▽
        g.FillPolygon(accentBrush, new[] { P(47, 63), P(57, 63), P(52, 71) });
        return bmp;
    }

    private static GraphicsPath RoundedRect(RectangleF r, float radius)
    {
        float d = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(r.Left, r.Top, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Top, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.Left, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    // An .ico with PNG-compressed images: a 6-byte header, a 16-byte entry per
    // image, then the images. (256 is written as 0 in the width/height byte.)
    private static byte[] PackIco(List<(int Size, byte[] Data)> images)
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        w.Write((ushort)0); w.Write((ushort)1); w.Write((ushort)images.Count);
        int offset = 6 + 16 * images.Count;
        foreach (var (size, data) in images)
        {
            w.Write((byte)(size >= 256 ? 0 : size)); w.Write((byte)(size >= 256 ? 0 : size));
            w.Write((byte)0); w.Write((byte)0);   // no palette, reserved
            w.Write((ushort)1); w.Write((ushort)32); // planes, bits per pixel
            w.Write(data.Length); w.Write(offset);
            offset += data.Length;
        }
        foreach (var (_, data) in images) w.Write(data);
        return ms.ToArray();
    }
}
