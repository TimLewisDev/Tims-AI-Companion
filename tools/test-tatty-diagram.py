#!/usr/bin/env python3
"""test-tatty-diagram.py: checks plugins/tatty/app/diagram.py, the reading behind the generated diagrams.
Standard library only; one line a check ("ok" or "FAIL"), exit 1 when any failed.

usage: test-tatty-diagram.py

It reads small C# files (no git), then makes a scratch git repository with a base branch and a feature
branch of two work units and checks the per-blob cache, the project graph and the review graph. No server
is started.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "plugins" / "tatty" / "app"))
import diagram as dg  # noqa: E402

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"ok {name}")
    else:
        failed += 1
        print(f"FAIL {name}" + (f": {detail}" if detail else ""))


def types_of(text):
    return {t["path"]: t for t in dg.parse_cs(text)["types"]}


# ---------------------------------------------------------------- one file

SRC = '''
using System;
using UnityEngine;
using Game.Core;

namespace Game.Ships
{
    /* a comment that says class Fake : Bad { */
    [Serializable]
    [AddComponentMenu("Ships/Thing")]
    public sealed partial class Ship : MonoBehaviour, IDamageable
    {
        [SerializeField] private Engine _engine = new Engine(3, "x { y");
        private List<Weapon> _weapons = new();
        public int Hull => _hull;
        public string Name { get; private set; }
        public event Action<Ship> Died;
        private char _brace = '{';

        public Ship() { }

        public void Fire(Target target)
        {
            var s = $"fired at {target.Name} {{ }}";
            var p = new Projectile(target);
            var m = Mode.Idle;
            if (s.Length > 0) { Debug.Log(s); }
        }

        private class Inner : Ship.Part<int> where T : class
        {
            public Inner(int a) { }
        }

        public enum Mode { Idle, Firing = 2, Dead }
    }

    public interface IDamageable { void Hit(int amount); }

    public record Shot(Weapon From, int Damage);

    public readonly struct Arc { public readonly float Width; }
}
'''

t = types_of(SRC)
check("finds every type, nested ones too", set(t) == {"Ship", "Ship.Inner", "Ship.Mode", "IDamageable", "Shot", "Arc"}, sorted(t))
check("a comment's 'class' is no type", "Fake" not in t)
ship = t.get("Ship", {})
check("namespace", ship.get("ns") == "Game.Ships", ship.get("ns"))
check("modifiers", set(ship.get("mods", [])) >= {"sealed", "partial"}, ship.get("mods"))
check("base list", [b["name"] for b in ship.get("bases", [])] == ["MonoBehaviour", "IDamageable"], ship.get("bases"))
sigs = {m["sig"]: m for m in ship.get("members", [])}
check("a field with an initialiser is a field", sigs.get("private Engine _engine", {}).get("kind") == "field", list(sigs))
check("an expression-bodied property", sigs.get("public int Hull", {}).get("kind") == "property")
check("an auto property", sigs.get("public string Name", {}).get("kind") == "property")
check("a constructor", any(m["kind"] == "ctor" for m in ship.get("members", [])))
check("a method", sigs.get("public void Fire(Target target)", {}).get("kind") == "method", list(sigs))
check("an event", any(m["kind"] == "event" for m in ship.get("members", [])))
check("a field's type is a 'has' name", {"Engine", "List", "Weapon"} <= set(ship.get("has", [])), ship.get("has"))
check("new T( is a 'creates' name", "Projectile" in ship.get("creates", []), ship.get("creates"))
check("a parameter's type is a 'uses' name", "Target" in ship.get("uses", []), ship.get("uses"))
check("braces in strings and chars don't end the class", t.get("Ship.Inner", {}).get("path") == "Ship.Inner")
check("a generic constraint's 'class' is no type", "T" not in t)
check("enum values are members", [m["sig"] for m in t.get("Ship.Mode", {}).get("members", [])] == ["Idle", "Firing", "Dead"])
check("a record's primary constructor gives properties", "Weapon" in t.get("Shot", {}).get("has", []), t.get("Shot"))
check("line of a type", ship.get("line") == 11, ship.get("line"))
check("file-scoped namespace", types_of("namespace A.B;\npublic class C { }\n")["C"]["ns"] == "A.B")
check("usings are kept", dg.parse_cs(SRC)["usings"] == ["System", "UnityEngine", "Game.Core"])

# ---------------------------------------------------------------- linking

files = {
    "Assets/Game/Ships/Ship.cs": dg.parse_cs(SRC),
    "Assets/Game/Ships/Ship.Part.cs": dg.parse_cs("namespace Game.Ships { public partial class Ship { public Weapon Spare; } }"),
    "Assets/Game/Core/Weapon.cs": dg.parse_cs("namespace Game.Core { public class Weapon : IDamageable2 { } public interface IDamageable2 {} }"),
    "Assets/Game/Core/Engine.cs": dg.parse_cs("namespace Game.Core { public class Engine { } }"),
    "Assets/Game/Other/Engine.cs": dg.parse_cs("namespace Game.Other { public class Engine { } }"),
    "Packages/lib/Runtime/Target.cs": dg.parse_cs("namespace Lib { public class Target { } }"),
}
dirs = {"Packages/lib/Runtime": ("Lib.Runtime", True)}
m = dg.Model(files, dirs)
check("partial types are merged", any(x["sig"] == "public Weapon Spare" for x in m.types["Game.Ships.Ship"]["members"]))
links = {(to, k) for to, k, _ in m.links("Game.Ships.Ship")}
check("implements an interface", ("Game.Ships.IDamageable", "implements") in links, links)
check("has, through a using", ("Game.Core.Weapon", "has") in links, links)
check("the Engine in scope, not the other one", ("Game.Core.Engine", "has") in links and not any(to == "Game.Other.Engine" for to, _ in links), links)
check("a name nothing makes visible isn't linked", not any(to == "Lib.Target" for to, _ in links), links)
check("its own nested type is in scope", ("Game.Ships.Ship.Mode", "uses") in links, links)
check("Unity stereotype", m.stereo(m.types["Game.Ships.Ship"]) == "MonoBehaviour")
check("assembly from an asmdef folder", m.types["Lib.Target"]["asm"] == "Lib.Runtime", m.types["Lib.Target"]["asm"])
check("Unity's default assembly", m.types["Game.Core.Engine"]["asm"] == "Assembly-CSharp")
g = dg.project_graph(m)
check("project graph: a node a type", len(g["nodes"]) == len(m.types))
check("groups: assembly and namespace", {"a:Assembly-CSharp", "n:Assembly-CSharp/Game.Ships"} <= {x["id"] for x in g["groups"]})
check("gedges count links between groups", any(e["from"] == "n:Assembly-CSharp/Game.Ships" and e["to"] == "n:Assembly-CSharp/Game.Core" for e in g["gedges"]))

# ---------------------------------------------------------------- git: the cache and a review


def git(repo, *args):
    p = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stdout.strip()


with tempfile.TemporaryDirectory() as tmp:
    repo = Path(tmp) / "repo"
    (repo / "Assets" / "Game").mkdir(parents=True)
    git(tmp, "init", "-q", "-b", "main", str(repo))
    git(repo, "config", "user.email", "t@t")
    git(repo, "config", "user.name", "t")
    (repo / "Assets" / "Game" / "Core.cs").write_text("namespace G { public class Core { public int A; } public class Old { } }")
    (repo / "Assets" / "Game" / "Lib.cs").write_text("namespace G { public class Lib { } }")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    git(repo, "switch", "-qc", "feature")
    (repo / "Assets" / "Game" / "Core.cs").write_text("namespace G { public class Core { public int A; public Lib L; } }")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "core uses lib (WU1)")
    (repo / "Assets" / "Game" / "New.cs").write_text("namespace G { public class Added : Core { } }")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "a new type (WU2)")

    idx_file = Path(tmp) / "index.json"
    ix = dg.Index(repo, idx_file)
    hf, hd, hsha = ix.tree("feature")
    ix.save()
    check("tree: every C# file at the commit", set(hf) == {"Assets/Game/Core.cs", "Assets/Game/Lib.cs", "Assets/Game/New.cs"}, sorted(hf or {}))
    check("the cache is written", idx_file.is_file())
    ix2 = dg.Index(repo, idx_file)
    real = dg.parse_cs
    calls = []
    dg.parse_cs = lambda text: calls.append(1) or real(text)
    ix2.tree("feature")
    check("a blob seen before isn't read again", not calls, f"{len(calls)} parse(s)")
    bf, bd, bsha = ix2.tree("main")
    check("only the base's new blobs are read", len(calls) == 1, f"{len(calls)} parse(s)")
    dg.parse_cs = real
    excl, _, _ = dg.Index(repo, Path(tmp) / "i2.json").tree("feature", exclude=("Assets/Game/Lib",))
    check("a folder left out is left out", "Assets/Game/Lib.cs" not in excl)

    changed = {"Assets/Game/Core.cs": "M", "Assets/Game/New.cs": "A"}
    units = {"WU1": {"Assets/Game/Core.cs"}, "WU2": {"Assets/Game/New.cs"}}
    rg = dg.review_graph(dg.Model(hf, hd), dg.Model(bf, bd), changed, units)
    st = {n["label"]: n for n in rg["nodes"]}
    check("review: an added type", st.get("Added", {}).get("state") == "added", {k: v["state"] for k, v in st.items()})
    check("review: a changed type", st.get("Core", {}).get("state") == "changed")
    check("review: a removed type", st.get("Old", {}).get("state") == "removed")
    check("review: an unchanged type it links to", st.get("Lib", {}).get("state") == "unchanged")
    check("review: units", st.get("Core", {}).get("units") == ["WU1"] and st.get("Added", {}).get("units") == ["WU2"])
    check("review: a member added", any(x.get("state") == "added" and "Lib L" in x["sig"] for x in st.get("Core", {}).get("members", [])))
    es = {(e["from"].rsplit(".", 1)[-1], e["to"].rsplit(".", 1)[-1], e["kind"]): e for e in rg["edges"]}
    check("review: a new link", es.get(("Core", "Lib", "has"), {}).get("state") == "added", list(es))
    check("review: the new type's base", es.get(("Added", "Core", "inherits"), {}).get("state") == "added")
    check("review: units listed in order", [u["id"] for u in rg["units"]] == ["WU1", "WU2"])
    many = {f"Assets/Game/D{i}.cs": dg.parse_cs(f"namespace G {{ public class D{i} {{ }} }}") for i in range(12)}
    wide = dict(hf, **many, **{"Assets/Game/Wide.cs": dg.parse_cs("namespace G { public class Wide { "
                                                                    + " ".join(f"public D{i} F{i};" for i in range(12)) + " } }")})
    wg = dg.review_graph(dg.Model(wide, hd), dg.Model(bf, bd), {"Assets/Game/Wide.cs": "A"}, {})
    check("review: a changed type shows its strongest few unchanged links", len(wg["nodes"]) == 1 + dg.NEIGHBOURS, len(wg["nodes"]))

    pg = dg.plan_merge(dg.Model(hf, hd), {"nodes": [
        {"name": "Core", "namespace": "G", "change": "changed", "steps": ["§1"], "members": ["public void Run()"]},
        {"name": "Planner", "namespace": "G.Plan", "assembly": "Game", "kind": "class", "change": "new", "steps": ["§2"], "summary": "Plans."},
    ], "edges": [{"from": "Planner", "to": "Core", "kind": "dataflow", "label": "the plan", "steps": ["§2"]}]},
        [{"id": "§1", "label": "one"}, {"id": "§2", "label": "two"}])
    pn = {n["label"]: n for n in pg["nodes"]}
    check("plan: an existing type takes the code's members", any(x["sig"] == "public Lib L" for x in pn.get("Core", {}).get("members", [])))
    check("plan: the plan's members are added", any(x["sig"] == "public void Run()" and x.get("state") == "added" for x in pn.get("Core", {}).get("members", [])))
    check("plan: a new type is planned", pn.get("Planner", {}).get("state") == "planned" and pn["Planner"]["summary"] == "Plans.")
    check("plan: data flow kept, with its words", any(e["kind"] == "dataflow" and e.get("label") == "the plan" for e in pg["edges"]))
    check("plan: steps are the units", [u["id"] for u in pg["units"]] == ["§1", "§2"])
    check("plan: only the types the plan names", sorted(pn) == ["Core", "Planner"], sorted(pn))
    json.dumps(pg)

print(f"{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
