using System;
using System.IO;
using System.Text.Json;
using System.Windows;

namespace TtCompanion
{
    // Whether Tatty may move at all. One place, because the avatar and the stage
    // have to agree, and three answers in order of authority:
    //
    //   TATTY_ANIMATE=1|0  for the tests, which must be able to see the confetti
    //                      on a machine that has animation turned off
    //   the tray menu      the person's own answer for Tatty, remembered
    //   the OS             Settings ▸ Accessibility ▸ Visual effects, the default
    //
    // The OS comes last because it is a default and not a veto: a desktop with
    // its animations off is a common thing to want, and a pet robot that dances
    // anyway is a reasonable thing to want with it -- so Tatty keeps still until
    // he is told otherwise, and then it is one click in his own menu.
    internal static class Motion
    {
        public static bool? Chosen { get; set; } // null: whatever the OS says

        public static bool On => Forced ?? Chosen ?? SystemParameters.ClientAreaAnimation;

        private static bool? Forced =>
            Environment.GetEnvironmentVariable("TATTY_ANIMATE") switch { "1" => true, "0" => false, _ => (bool?)null };
    }

    // What the person has chosen about Tatty himself, from the tray menu. It sits
    // beside the panel's bounds in %LOCALAPPDATA%\Tatty (BubbleWindow's
    // companion.json) but in a file of its own, so saving one can never cost the
    // other. Every read and write is best-effort: a companion that can't write a
    // preference should still run.
    //
    // These are the tray app's own, and nothing to do with the server's settings
    // (<TATTY_HOME>/settings.json, the Settings page): they are about how Tatty
    // behaves on this desktop, which is the one thing the page can't see.
    internal sealed class Settings
    {
        public bool Sound { get; set; } = true;
        public bool Effects { get; set; } = true;

        // Whether Tatty moves: null until the person says, and then theirs
        // either way (see Motion).
        public bool? Lively { get; set; }

        // Tatty normally tucks himself away once nothing is pending. With this on
        // he stays on the desktop and gets on with his own day.
        public bool StayVisible { get; set; }

        private static string Where => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tatty", "avatar.json");

        public static Settings Load()
        {
            try
            {
                return JsonSerializer.Deserialize<Settings>(System.IO.File.ReadAllText(Where)) ?? new Settings();
            }
            catch (Exception)
            {
                return new Settings();
            }
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Where)!);
                System.IO.File.WriteAllText(Where, JsonSerializer.Serialize(this));
            }
            catch (Exception) { }
        }
    }
}
