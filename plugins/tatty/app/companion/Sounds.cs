using System;
using System.Collections.Generic;
using System.IO;
using System.Media;

namespace TtCompanion
{
    // Tatty's two noises: a chime when something waits for an answer, and a
    // flourish when a section is finished.
    //
    // They are worked out here rather than shipped as files, for the same reason
    // Tatty's icon is drawn in code (App.xaml.cs's MakeIcon): there is then
    // nothing binary to keep, and a cue can be retuned by changing the notes. A
    // cue is a handful of bell-ish notes mixed into a few kilobytes of PCM, which
    // SoundPlayer plays from memory.
    internal sealed class Sounds
    {
        public enum Cue { Question, Milestone, Complete, Blip }

        // Notes are (pitch in Hz, how long until the next one); each goes on
        // sounding past its turn, so they ring into each other like a chime.
        private static readonly Dictionary<Cue, (double Hz, double Spacing)[]> Score =
            new Dictionary<Cue, (double, double)[]>
            {
                [Cue.Question] = new[] { (880.0, 0.13), (1108.7, 0.3) },                                  // A5 → C♯6
                [Cue.Milestone] = new[] { (1046.5, 0.11), (1318.5, 0.11), (1568.0, 0.3) },                // C6 E6 G6
                [Cue.Complete] = new[] { (783.99, 0.1), (1046.5, 0.1), (1318.5, 0.1), (1568.0, 0.14), (2093.0, 0.4) },
                [Cue.Blip] = new[] { (1318.5, 0.08) },
            };

        private const int Rate = 44100;
        private const double Ring = 0.34;  // how long a note sounds after its turn
        private const double Loud = 0.34;  // an alert, not a klaxon

        private readonly Dictionary<Cue, SoundPlayer> ready = new Dictionary<Cue, SoundPlayer>();
        private DateTime last;

        public bool Enabled { get; set; } = true;

        // One cue at a time and never two on top of each other: these are alerts,
        // and a pile of them says less than one.
        public void Play(Cue cue)
        {
            if (!Enabled) return;
            var now = DateTime.UtcNow;
            if (now - last < TimeSpan.FromSeconds(2)) return;
            last = now;
            try
            {
                Player(cue).Play();
            }
            catch (Exception) { } // no sound card, no sound: nothing else changes
        }

        // Straight away, whatever was played a moment ago: the previews in his
        // menu are asked for one at a time, by somebody who wants to compare them.
        public void Preview(Cue cue)
        {
            last = DateTime.MinValue;
            Play(cue);
        }

        private SoundPlayer Player(Cue cue)
        {
            if (ready.TryGetValue(cue, out var had)) return had;
            var player = new SoundPlayer(new MemoryStream(Wav(Score[cue])));
            player.Load();
            ready[cue] = player;
            return player;
        }

        // ------------------------------------------------------------ the synth

        // A WAV file, whole, in memory: 16-bit mono PCM at 44.1 kHz, which is the
        // one format SoundPlayer is sure of.
        private static byte[] Wav((double Hz, double Spacing)[] notes)
        {
            short[] pcm = Mix(notes);
            using var stream = new MemoryStream();
            using var w = new BinaryWriter(stream);
            int bytes = pcm.Length * 2;
            w.Write(new[] { 'R', 'I', 'F', 'F' });
            w.Write(36 + bytes);
            w.Write(new[] { 'W', 'A', 'V', 'E', 'f', 'm', 't', ' ' });
            w.Write(16);                      // the size of the format block
            w.Write((short)1);                // PCM, uncompressed
            w.Write((short)1);                // mono
            w.Write(Rate);
            w.Write(Rate * 2);                // bytes a second
            w.Write((short)2);                // bytes a frame
            w.Write((short)16);               // bits a sample
            w.Write(new[] { 'd', 'a', 't', 'a' });
            w.Write(bytes);
            foreach (short s in pcm) w.Write(s);
            w.Flush();
            return stream.ToArray();
        }

        // Each note is a sine with two quiet harmonics over it, which is enough to
        // sound struck rather than beeped, under an envelope that rises in 6 ms,
        // decays away, and is forced to nothing at the very end so no note ends in
        // a click.
        private static short[] Mix((double Hz, double Spacing)[] notes)
        {
            double total = 0;
            foreach (var n in notes) total += n.Spacing;
            var mix = new double[(int)((total + Ring + 0.05) * Rate)];
            double at = 0;
            foreach (var n in notes)
            {
                int start = (int)(at * Rate);
                double length = n.Spacing + Ring;
                int span = (int)(length * Rate);
                for (int i = 0; i < span && start + i < mix.Length; i++)
                {
                    double t = (double)i / Rate;
                    double envelope = Math.Min(1, t / 0.006)
                                    * Math.Exp(-2.4 * t / length)
                                    * Math.Min(1, (length - t) / 0.02);
                    double wave = Math.Sin(2 * Math.PI * n.Hz * t)
                                + 0.28 * Math.Sin(4 * Math.PI * n.Hz * t)
                                + 0.1 * Math.Sin(6 * Math.PI * n.Hz * t);
                    mix[start + i] += envelope * wave / 1.4;
                }
                at += n.Spacing;
            }
            var pcm = new short[mix.Length];
            for (int i = 0; i < mix.Length; i++)
                pcm[i] = (short)(Math.Clamp(mix[i] * Loud, -1, 1) * short.MaxValue);
            return pcm;
        }
    }
}
