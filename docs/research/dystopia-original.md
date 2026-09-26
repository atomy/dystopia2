# Dystopia (Team Dystopia / Puny Human, 2005–2026): Design Reference

> Research compiled 2026-09-26 as a factual design reference for a spiritual sequel ("Dystopia 2").
>
> **How to read this document**
> - Numbers come mostly from the **official Dystopia wiki** (wiki.dystopia-game.com). Most pages there describe **v1.2 (2009)**. Where later patches (1.3 in 2010, 1.4 in 2013, 1.5.x from 2018 to 2026) changed a value, the change is noted.
> - **[~]** marks something that is uncertain, version-dependent, derived by me, or contradicted between sources.
> - **[not found]** marks something named in the research brief that I could not verify in any source. Treat it as not part of the game.
> - The Fandom wiki (dystopia.fandom.com) documents the **pre-1.0 beta era (2005–06)**. I use it only for history and cut features.

---

## 0. TL;DR for designers

- **Genre:** asymmetric, objective-based, attack/defend team FPS in the style of Enemy Territory or UT Assault, set in a cyberpunk world. Its defining idea is **dual-layer maps**: a physical "meatspace" and an abstract 3D "cyberspace". Players called deckers jack into cyberspace to control meatspace devices: turrets, doors, hatches, spawns, lasers, traps, lifts, and sometimes the objective itself.
- **Loadout = class + 1 of 4 primaries + implants.** There are three armor classes (Light, Medium, Heavy). Each class has fixed **head/body implant slots**, and implants are paid for with slots, not points. Many implants spend a shared, regenerating **energy** pool (50 base, 75 with SCS). A player can change the whole loadout on every respawn.
- **Wave respawns:** each team has its own timer. It resets to about 15 s after each wave, and every dead player adds a class-dependent penalty (Light 3 s, Medium 4 s, Heavy 6 s). Dying in groups is therefore punished hard. Defenders get an instant spawn briefly after losing an objective.
- **Cyberspace:** a fast, bouncy, reorientable-gravity arena. Energy is your HP, your ammo, and your build resource. You have three weapons (Hitscan, Shaft, Projectile) plus a hacking layer of programs. Offensive programs break protections (Password Cracker, Decryptor, Wedge, ICE Breaker, ICE Scan). Defensive programs add them (Password Protect, Encryption, ICE Barrier, ICE Alarm, ICE Mine, Green ICE). Your meat body stays behind, **helpless**, at the terminal.
- **Players loved:** the meat/cyber interplay, deep teamwork, a high skill ceiling, distinctive weapons (Boltgun, Smartlocks, Tesla, guided rockets), implant counterplay, bunny-hop/leg-boost movement, and the atmosphere.
- **Players criticized:** a brutal learning curve and jargon, maps that were confusing and full of chokepoints, balance (Boltgun, Rocket, Smartlocks, Heavies in pubs, grenade spam), cyberspace being unintuitive for newcomers, waiting (spawn waves, one decker per JIP), a tiny player base and dead servers, griefing, and technical issues (Valve updates breaking the mod, netcode).

---

## 1. Overview

### 1.1 Setting and lore
- The world is a cyberpunk future dominated by megacorporations. The "present" is **2069** (Mike Sanders in GamesIndustry.biz 2009, and the wiki's lore timeline "Dystopian Era: 2050–2069 (Present)").
- **Teams:** **Punk Mercenaries ("Punks")** are oppressed renegades and mercenary groups operating outside the law. **Corporate Security Forces ("Corps")** are private security contractors. Both teams are mechanically identical; only the models and voices differ.
- **Respawn is diegetic.** Players are *combat clones*. In the lore, "Spawnpoints" (Rapid Adjustment Clone Actualization Platforms, 2060) rebuild bodies from resource tanks. A brain-stem **Combat Control Unit** backs up the mind. Teleport capacitors can only fire about every 12 s, which explains the wave respawns. The same CCU runs the HUD and the info implants.
- **Cyberdecks** are brain-stem neural interfaces built on "Cybram crystals". In the lore they turned the Light from a scout into a "central tactical asset".
- There is a large amount of wiki lore: corporations (DataTrust, o7, BigMax, Nutrisoy, Union Cybersyn, Quetzuku…), punk groups (Switchblade…), and cities and an atlas. It was mostly community-written. Each map has a short backstory: for example, Vaccine attacks one of DataTrust's four "cyber-librarian" data cores.
- Influences named by the developers and press: Gibson, Philip K. Dick, Blade Runner, Tron, Shadowrun, Deus Ex (implants), Return to Castle Wolfenstein / Enemy Territory (objectives), and UT Assault.

### 1.2 Game mode and round structure
- There is **one main mode: asymmetric objective attack/defend.** One team attacks against a clock and the other defends. **Punks attack on every official map except dys_detonate and dys_broadcast**, where Corps attack.
- Each map has **3–5 main objectives, plus optional sub-objectives**. The map entity supports up to 6. Objectives usually unlock in sequence: in general only the next objective can be captured. The **final objective** ends the round, and the attackers must complete it before the time limit or the defenders win.
- **Objective types** (wiki "Devices"):
  - **Button:** press a screen.
  - **Breakable:** destroy a device with weapons fire.
  - **Area:** occupy a zone for a time.
  - **Carryable:** an item or "stored transmission" that enables one of the other three types.
  - Many objectives are **cyberspace buttons**, or **hybrids** that need meatspace and cyberspace actions together.
- **Sub-objectives** such as turrets, doors, vents, and alternate routes are marked with "!" icons. They often decide how a push goes.
- **Recapture / "backhacking":** some objectives, especially spawns and security, can be retaken by defenders. A defender who sneaks behind the attackers to do this is a "backhacker". Capturing a spawn objective moves both teams' spawn rooms forward (dys_spawn IDs 1–6).
- **Round time:** set by `mp_timelimit`. Community guides say rounds last "up to 20 minutes" [~ default value unverified]. `mp_rounds` sets rounds per map. **Stopwatch mode (ABBA)** is used competitively: teams swap sides and the second attacker must beat the first attacker's time (`timetobeat`). The official league (DGL) played **5v5**.
- **Friendly fire:** a server option, usually **on** in community play.
- **Phistball** was a secondary mode added in v1.0. It is soccer in small arenas (pb_dojo, pb_rooftop, pb_round, pb_urbandome), played with melee only. The first team to 10 goals wins. It started as a way to test new prediction code.

### 1.3 Spawn / respawn waves (v1.2 wiki, community guides, 1.4 changelog)
- Each team has its **own wave timer**. When it reaches 0, all dead teammates spawn together.
- After every wave the timer **resets to 15.0 s**.
- **Each death adds time to the team's timer**, scaled by class. The class pages list these as "spawn time": **Light 3 s, Medium 4 s, Heavy 6 s**. Because the addition hits the whole queue, a team wipe can stretch the timer toward a minute. This was a deliberate teamwork lever: spread out your deaths, and do not overstack Heavies.
- Starting with 1.4, the timer **caps at 18.0 s** and **waits at 5.0 s when nobody is in the queue**. The HUD beeps when a wave is coming.
- The **defending team gets instant respawn for a moment** after losing an objective, so it can re-form at the new line.
- If attackers fail to capture for a long time, **their timer accelerates, down to one third of normal**. It returns to normal after a capture.
- Map events can trigger a **force spawn**.
- **"Tactical respawn"** is a suicide (default key K). It refills HP and armor, which cannot otherwise be repaired, and lets a new loadout take effect. [~ The 2009 wiki says a suicide does not refill energy; the 1.23 patch made respawns during fast-spawn periods always give full energy, even after a suicide.]
- The loadout can be changed after spawning as long as you have not left the spawn pad or fired. Round-start grace periods also allow changes (a bug here was fixed in 1.5.3).
- 1.5.5 (2026) added optional server-side **spawn-time scaling by player count**.

### 1.4 World devices (meatspace)
- **Screens:** in-world VGUI panels pressed with Use or fire. Examples: door controls, "toggle screens" for contested pushes, DNA profilers, valves (hold Use).
- **Jack-In Points (JIPs):** terminals for deckers. They appear on radar. Their monitor shows the decker's cyberspace view live, rendered through a `point_camera` render target, so nearby players can watch. Some JIPs are disabled until objectives change.
- **Ammo dispensers:** team-neutral. They refill primary ammo and the machine pistol slowly, but **never grenades**. Grenades and armor are only restored by respawning.
- **Spawn pads:** invulnerable, in protected spawn rooms that are usually guarded by invulnerable turrets.
- **Turrets:** map-placed and team-owned, with unlimited ammo.
  - **Thermal** turrets see everyone, even Coldsuit users. **Optic** turrets ignore active Stealth.
  - They can be **invulnerable** or **destructible**. Destructible turrets auto-repair after a delay, and 1.5.5 added a per-map `respawntime`.
  - Deckers can **flip turret ownership in cyberspace**, which turns the defense against its owners.
- **Force fields** (team-pass), **automatic doors** (some team-locked, some screen- or cyber-controlled), and **traps**: gas, steam, fan kill-triggers, mechanical arms, mining lasers, crushing doors ("doorzilla").
- **Meatspace "cracking"** (added in 1.4): a player carrying a cyberdeck can stand in a `trigger_crackable` and "crack" an object with a progress bar. Uses include opening doors temporarily, or capturing a disabled screen in about 20 s on Undermine. This gave deckers a meatspace way to interact.

### 1.5 Movement
- Base run speeds (units/s): **Light 250 (sprint 312), Medium 200 (250), Heavy 160 (200)** [v1.2 wiki; the sprint values are with Leg Boosters].
- **Ledge grab / wall hang** for Lights and Mediums: grab ledges, shimmy, pull up. Heavies cannot ledge-grab but jump higher.
- **Bunny hopping** is intentional ("a feature, not a bug"). Hold jump to pogo. Leg Boosters allow charged vertical or horizontal (1.4) boosts, and chaining them into bhops is a core skill.
- **Leg Boosters** also negate fall damage. Without them, fall damage applies; many spawns drop you into it.
- **Crouch slide** (1.4): landing crouched above the speed cap makes you slide.
- **"Goomba":** landing a fully charged leg boost on an enemy's head deals 150 damage.
- Knockback matters. Armor loss increases vulnerability to knockback, and explosive knockback was raised 50% in 1.4.1.

### 1.6 Information systems and HUD
- **IFF boxes** on all players show friendly health, armor and energy, plus key implants. IFF was originally planned as an implant, but "everyone took it", so it became default. The optional **IFF Info** implant adds the same data for enemies.
- **Radar/minimap** with elevation-aware overhead images. It shows JIPs, dispensers, and markers. Enemies appear only when seen or **TAC-scanned**.
- **Objective markers** in-world: a circle for objectives, "i" for sub-objectives, "L" for points of interest. In later versions, floor arrows guide new players.
- **Hitbeep:** audible hit confirmation that stacks for multi-pellet weapons. It is a series trademark. 1.5.6 (2026) added damage indicators and floating damage numbers.
- **Voice comms menu:** e.g., "Requesting a Decker", "Requesting a Tacscan", "Stealther spotted", "Hack the security", "Defend me while I hack", "Secure the Jack-In Point". While decked, a "cyber microphone" lets the decker hear meatspace sounds near their body (range 384).
- **Stats and awards:** end-of-round awards ("Nurse Betty" for most healing, etc.) and a persistent global stats site (dystopia-stats.com). 42 Steam achievements.

### 1.7 Map list (official)
The current build (2025–26 community guide) has **19 official maps**: 13 objective maps (`dys_`), 4 Phistball (`pb_`), 1 training map, and 1 tutorial ("Lobby"). The classic marketing list was "10 assault maps + 4 Phistball" at v1.2.

| Map | Author | Setting | Attacker | Objective chain (summary) | Added |
|---|---|---|---|---|---|
| **dys_vaccine** | Termi | DataTrust data-management arcology | Punks | (1) Capture the **Docks** spawn. There are 3 entrances; the dock door and back door must be hacked open from cyberspace. (2) **Hack the Middle Spawn** from the security-room JIP. Deckers fight over the stair turrets and maintenance hatch in the contested "yellow" node. (3) **Destroy the Data Core**. Its security (turrets and a force field) must first be taken offline in the "red" node, then the team pushes through the airlock chokepoint. | First map, demo Sept 2005 |
| **dys_silo** | Termi | Decommissioned US missile silo, Arizona | Punks | (1) Capture the internal Corp spawn via a JIP (vents can be opened in cyber). (2) **Reroute power** to the control room (cyber). (3) **Launch the missile**: a JIP starts a 60 s launch countdown, which is cancelled if Corps re-route power. | Demo Update 4 (Jan 2006) |
| **dys_fortress** | Twincannon | DataTrust remote storage complex | Punks | (1) Destroy a hardware **firewall** in a guardhouse (meat). (2) **Extend the bridge** (cyber). (3) Open doors in cyber, then press a button to take the Corp spawn. A "meatlock" minigame offers an override. (4) **Destroy the reactor**: shoot through reinforced glass after hacking the reactor security. (5) **Smash the data-storage servers**. | Demo Update 4 |
| **dys_undermine** | Twincannon | High-tech corporate mine | Punks | (1) Capture the inner base from a JIP at the end of a gas tunnel. The gas is controlled in cyber, and a fast "push" link carries the decker in. (2) **Redirect the giant mining laser** to cause a cave-in. The button is in meat, but cyber must keep it enabled. (3) **Take 3 Extraction Units offline.** A meatspace panel for each EU flips ICE ownership in cyberspace. Each EU room admits **one decker per team**. All 3 offline wins the round. | v1.0 (2007) |
| **dys_detonate** | Trapt | City-ruins base | **Corps** | (1) Cut entrance spawn power (hack). (2) Shut down security (hack, then encrypt against backhacks). (3) **Destroy the cooling access door in cyberspace**. (4) Destroy the cooling tank (meat). | ~v1.0 [~] |
| **dys_assemble** | Termi | Subterranean DataTrust production facility | Punks | (1) **Shut down the turret production line** (cyber node via the production-room JIP). (2) Fire the test **laser to destroy a bulkhead** (cyber, behind ICE). In 1.4, Punks must also carry an item to drop a "frostwall". (3) **Open 8 data stores** via cyber buttons and destroy them in meat. Corps deckers can close them, but damage persists. There is also an alternate "uplink" path. | ~v1.0–1.1 [~] |
| **dys_broadcast** | Feanix (was 3rd-party "Radioshack") | Illegal nightclub in Seattle's sprawl | **Corps** | (1) **Capture the guard post** by hacking at its JIP. Sewer elevator and fire escape routes are toggled in cyber. (2) **Capture the interior spawn** with a DNA Profiler (a meat channel capture). Its room door can be locked in cyber. (3) **Destroy the broadcast server**: toggle firewall ports in meat, cut the elevator and ventilation in cyber, destroy the router, and drop the server defences. | ~v1.1–1.2 [~] |
| **dys_cybernetic** | Venciera | Union Cybersyn coastal arcology | Punks | (1) **Destroy the transformer**; its shield is toggled in cyber. (2) **Hack spawn controls** by lowering 3 software firewalls, then capturing the central node. (3) **Locate the hostage profile** in a cyber minigame: track an orange datacube on a carousel 3 times. (4) **Escort the hostage's life-support pod** to a teleporter. | Revamped for v1.2 (2009) |
| **dys_exodus** | Lez, Charlestheoaf, Termi, Twincannon | Refurbished secure community | Punks | (1) Activate 3 generators in meat and lock each in cyber, then projectile-jump to a cyber button. (2) Destroy the Corp checkpoint. (3) Disable the SeCorp communications relay at a monorail station. (4) **Retrieve and transmit the data** (4 cyber buttons at the final JIPs). | ~v1.1–1.2 [~] |
| **dys_injection** | Termi | Quetzuku habitation-dome arcology | Punks | (1) Capture the interior spawn: hack the code room, or **read a 4-digit code** and use it from the safe spawn JIP. Corps can reset the code in cyber. (2) Enable the auxiliary power feed (hack). (3) Enable the 4-point override. (4) **Inject the virus**: turn valves in 4 towers (hold Use), then a decker climbs a cyber tower on jump pads to launch it. | v1.2 (2009) |
| **dys_fusion** | Fedio (3rd-party, made official) | Quantum Tech power station | Punks | (1) Break into the compound by destroying a wall. (2) Turn off security (cyber, recapturable). (3) **Destroy 16 fuel rods**; cyber controls a teleporter and the reactor turrets. | v1.3 (2010) |
| **dys_coast** | [~ unknown, Puny Human era] | [~ coastal facility] | Punks | 1.4 design: (1) Carry explosives to 3 points and trigger them via cyber. (2) Capture a Corp key card, then hack. (3) **Collect data chunks in cyberspace** while meat players hold a button that makes it easier. (4) **Craft viruses in cyberspace at spawn and carry them into meatspace.** Retuned in 1.5.4. | v1.4 (2013), textured by 1.5.4 |
| **dys_fortress_classic** | — | Older layout of Fortress | Punks | Listed as official in current builds [~ details unverified] | later |
| pb_dojo / pb_rooftop / pb_round / pb_urbandome | — | Phistball arenas | — | Melee-only ball game, first to 10 | v1.0 |

- **Third-party maps** added to the official build in 1.4.1 (2014): dys_anarchy, crysmack, desert, drilling, infect, parity, parkour, spamball, spiderweb, stronghold, subtech, tower, tyrell, and sav_dojo. The community lists **100+ custom maps**. dys_racetrack was a third-party vehicle arena.
- **dys_fixation, dys_escape, dys_road:** **[not found]** in the official wiki, map lists, changelogs, or community map guides. They appear not to be real Dystopia maps.

---

## 2. Classes ("Augmented Armor")

Values are from the v1.2 official wiki (2009) unless noted.

| | **Light** | **Medium** | **Heavy** |
|---|---|---|---|
| Health | 75 | 100 | 140 |
| Armor | 25 | 50 | 100 (v1.2). The wiki's armor page, "updated to 1.3", gives **200** [~] |
| Implant slots | **5 head / 7 body** | **4 head / 4 body** | **2 head / 2 body** (v1.2). By Aug 2010 (1.3) the wiki says Heavies have **general slots** usable for head or body implants [~ count unverified] |
| Energy | 50 (all classes; 75 with SCS) | 50 | 50 |
| Run / sprint (u/s) | 250 / 312 | 200 / 250 | 160 / 200 |
| Respawn penalty | +3 s | +4 s | +6 s |
| Primaries | Shotgun, Laser Rifle, Smartlock Pistols, Boltgun | Assault Rifle (MK-405), MK-808 rifle, Grenade Launcher, Tesla Rifle | Minigun, Ion Cannon, Basilisk, Rocket Launcher |
| Melee | Katana (60; 1.4 changed it to faster/weaker) | Katana (90, then 75 from 1.23) | Fatman Fist (120, unblockable, knocks props) |
| Sidearm | Machine Pistol | Machine Pistol | Machine Pistol |
| Grenades | 3× **EMP** | 2× **Frag** | 2× **Spider** |
| Special | Only class with **Stealth**; ledge grab | Ledge grab; can deck and heal | Cannot ledge-grab; higher jump; cannot deck, TAC, heal or stealth |

- **Design statement** (wiki "Classes"): "Classes with more armor jump higher, have more health, and have more powerful weapons. Classes with less armor are smaller, have more implant diversity, move faster, and have shorter respawn penalties."
- Weapon design rule, from early dev chatter on the Fandom wiki: each class gets roughly "one close hitscan, one range hitscan, and one projectile" (later four weapons).
- **Armor system:** armor absorbs **80% of non-explosive damage** and 20% always goes to health. **Explosives deal double damage to armor**, which makes the GL, frags, rockets, spiders and cortex bomb anti-Heavy tools.
  - Armor **cannot be repaired** in the field; only respawning restores it. The Mediplant heals health only.
  - This is the reason for "tactical suicide", and it drew criticism ("Armor can't be repaired so suicide is a good idea").
- **1.3 (2010) changes** from the Nov 2009 changelog draft:
  - The Mediplant gives **+25 max HP**.
  - Wired Reflexes stopped affecting reload times.
  - The TAC scan became a snapshot instead of continuous tracking.
  - Other balance tweaks.
- Earlier concepts that were cut:
  - Light "Claws" melee (in the demo, removed for v1).
  - Medium "Plasma Rifle", removed for feeling "too Quake".
  - Vehicles: the drivable "Brute" car. Code shipped in the v1 RC and third-party maps used it, but it was never in official objective maps. The planned "insertion phase" with vehicles was never delivered.
  - A "TADS" implant (Target Acquisition and Deployment System; probably auto-aim) was removed.

---

## 3. Implants

### 3.1 Energy system
- **Max energy: 50** for every class. **SCS** raises it to **75**.
- Energy **regenerates** at a standard rate. [~ The base rate is not stated directly. The 1.4 changelog says Coldsuit gives "+25% more energy regeneration (+0.5/second)", which implies a **base of about 2.0 energy/s**.]
- **Active** implants cost energy, either while toggled on or per use, and stop working at 0. **Passive** implants are free and always on.
- **EMP** disables **all** implants, active and passive (except SCS), jams the HUD and hearing, and **stops energy regeneration** for about 5–20 s depending on proximity. Some implants, such as the Mediplant, must be manually re-enabled afterwards.
- Implant keys are auto-assigned to **F1–F5 in loadout order**, so the key for an implant changes when the loadout changes (a criticized UX point). Implants can also be bound directly via console.
- Holding a leg-boost charge without sprinting **pauses regeneration** (1.4.1).

### 3.2 Implant table (v1.2 slot costs; 14 implants)

| Implant | Slot type / cost | Classes | Energy | Effect |
|---|---|---|---|---|
| **Enhanced Cyberdeck** ("Advanced") | Head 3 | L, M | 0.25/s while decked, plus program and weapon costs | Enter cyberspace. Full program set (Encryption, ICE Barrier, ICE Mine, Green ICE, ICE Breaker). Program **minigame** can halve run time and energy. |
| **Cyberdeck** | Head 2 (it was 3 in the beta) | L, M | 0.25/s while decked | Enter cyberspace. Same combat abilities, but a limited program set (defence only Password Protect and ICE Alarm; no ICE Breaker) and no minigame speedup. |
| **TAC Scanner** (Target Acquisition & Correlation) | Head 3 | L, M | **15 per scan**, short cooldown | Pings all players through walls. Results are **shared with the whole team** on radar and HUD for a few seconds. Detects stealth, coldsuit and silenced players. Range 2048, raised to 10,000 in 1.4. |
| **Thermal Vision** | Head 2 | L, M, H | Continuous drain [~ rate not documented] | Heat view that reveals Stealth and dark corners. Coldsuit users are invisible to it. Enemy IFF boxes are hidden while it is on (teamkill risk). Users show glowing red eyes. |
| **Sound Wave Triangulator (SWT)** | Head 2 | L, M, H | 0.75/s | A HUD cone/compass that shows enemy sounds through walls. Red is footsteps, yellow gunfire, white impacts, and purple (1.4) implants. Countered only by the Sound Suppressor. |
| **IFF Info** | Head 1 | L, M, H | Passive | Shows enemy health, armor and energy, their key implants (deck, mediplant), turret health, and enemy grenades. |
| **Cortex Bomb** | Head 1 | L, M, H | Passive | Charges when HP drops below 25 (with an audible whine), then explodes for **256 explosive damage, radius 512**, killing the user. It is cancelled if healed above 25 or if the user is killed first. It does not detonate fully when no enemies are near. |
| **Stealth Suit** | Body 5 | **Light only** | **1/s while cloaked** | Near-invisibility that becomes total when still (and, from 1.4, while crouch-moving). The user flickers when moving, firing or hit, and blood still shows. Optic turrets and spiders lose the user. **Cannot combine with Mediplant or Coldsuit.** |
| **Coldsuit** | Body 2 | L, M, H | Passive | Invisible to Thermal Vision, but not to thermal turrets. From 1.4 it also gives +25% energy regen. |
| **Mediplant** | Body 3 | L, M | 1.2: **10 energy heals a teammate 15 HP; 5 energy heals self 5 HP**. 1.4: self-heal free (4 HP), teammate 8 energy for 16 HP (Heavies get 24) | Area heal (range 256, then 512 in 1.4, then 384 in 1.4.1) that is more efficient on others than on self, so medics pair up. It auto-pauses while decking. The 1.3 changelog draft adds +25 max HP [~]. Health only, no armor. |
| **Leg Boosters** | Body 2 | L, M, H | 1.25/s sprinting; up to 20 per boost jump (1.4.1: L 15 / M 20 / H 30) | Faster sprint, charged boost jump (vertical, or horizontal from 1.4), **no fall damage**, goomba stomps. A 2020s community guide believes it is the "#1 used implant in the game". |
| **Sound Suppressor** | Body 1 | L, M, H | 0.5/s | Silences footsteps, weapons, and (from 1.4) implant sounds; hides the user from SWT. Weapon impacts are still heard. |
| **Wired Reflexes** | Body 1 | L, M, H | Passive | 1.2: faster reloads (e.g., AR 4.0 s to 3.0 s), faster ledge grab, and faster katana block recovery. It changed later: 1.3 faster weapon swap instead of reload; 1.4 machine-pistol spread −20% (−50% in 1.4.1) and no screen shake. |
| **SCS** (Superconductor Capacitor Storage) | Body 1 | L, M, H | Passive | +25 max energy (50 to 75). Regen is unchanged. Considered mandatory for serious deckers ("SCS is basically your health pool in cyber"). |

- **Classic loadout archetypes**, from the community and devs:
  - **Stealth Light:** Stealth, Sound Suppressor, SCS, with Shotgun or Katana and EMPs. It hunts deckers' bodies.
  - **Support Medium:** AR, **TAC + Mediplant**. This is the loading-screen recommendation for new players.
  - **Decker:** Light or Medium with Enhanced Cyberdeck and SCS. A Medium with a basic Cyberdeck can also fit Thermal.
  - **Heavy:** Thermal + SWT or Leg Boosters. Leg-boosting Heavies became a meta.
- **Counter web** (a core design strength):
  - Stealth is countered by Thermal, TAC, SWT, EMP (reveals the stealther) and high-RoF weapons (damage flicker).
  - Thermal is countered by Coldsuit, which is countered by toggling Thermal off (or watching shadows), which is countered by TAC.
  - SWT is countered by the Sound Suppressor.
  - Deckers are countered by EMP (it force-ejects them), stealth assassins, and goomba stomps.

### 3.3 Implants in the research brief that did not exist
- "Health Regen", "Aural Amp", "Smartlink", "Juggernaut", and "Tactical Radar/Target Acquisition System": **[not found]** as Dystopia implants.
  - The closest equivalents are the Mediplant (regen), SWT (audio), the Smartlock Pistols (a lock-on weapon, not an implant), and the TAC Scanner (the radar).
  - IFF existed first as an implant, then became always-on; "IFF Info" is the enemy-info upgrade.

---

## 4. Weapons

**Totals:** 12 primaries (4 per class), 2 melee weapons (Katana, Fatman Fist), 1 sidearm, and 3 grenade types. The official feature list calls this "Eighteen destructive weapons". Every primary has a meaningful **alt-fire**.

### 4.1 Stats (official wiki "Damage Table", ~v1.2/1.3; later changes noted)

| Weapon | Class | Primary | Alt-fire | Key numbers | Later changes |
|---|---|---|---|---|---|
| **Machine Pistol** | All | Full-auto, constant spread | — | 10 dmg, 10 rps, mag 24, 6° spread | WR reduces spread (1.4 and later) |
| **Shotgun** | L | Single barrel (7 pellets × 8) | **Double barrel** (14 × 8, double spread) | 2.5 / 1.25 shots/s, 6 shells loaded one at a time | 1.4: 10 × 5. 1.4.1: reverted. 1.5.4: 14 × 4 with a fixed spread pattern |
| **Laser Rifle** | L | **Charge 3 s, release at peak** (the beam is visible and audible while charging) | Zoom (variable) | 175 max / 263 headshot; 10% damage at ≤64 u rising to full at ≥512 u; energy ammo, no reload | 1.4: minimum 20% up close. It has a dedicated "Laser Rifle Complaints" wiki page |
| **Smartlock Pistols** | L | Akimbo auto pistols | **Fire tracer rounds** (1 per pistol). A tagged target is **auto-tracked** while visible | 16 dmg, 6.66 rps, mag 30 | 1.4: "Uzi-like", double RoF and half damage, mag 48. **1.5.5 experiment:** hold RMB to "paint" locks (768 u range); the lock tone is directional; about −20% DPS |
| **Boltgun** | L | Electrified bolt: projectile, bounces at shallow angles, pins bodies | **Discharge** the oldest bolt in flight or in a wall (256 radius) | 85 / 127 HS / 48 discharge, mag 3 (loaded singly), 1 rps | 1.5.5: 82 so a headshot no longer one-shots a full Light; bolts embed in moving doors |
| **Assault Rifle (MK-405)** | M | Full-auto; RoF ramps 7 to 13 rps while spread grows | Zoom + **3-round zero-spread burst** | 15 / 22.5 HS, mag 40 | 1.4: alt became a 5-pellet "shotgun". 1.5.4: 20 × 6 pellets |
| **MK-808 Rifle** | M | Semi-auto, 0 spread | Zoom | 50 / 75 HS, mag 8, 0.59 s between shots | — |
| **Grenade Launcher** | M | Bouncing grenade that explodes after a timer | **Arm the grenade to explode on next contact** (hold alt, then fire) | 65 explosive (×2 vs armor), radius 225, mag 4 | Many timing tweaks; called "the perfect spam weapon" |
| **Tesla Rifle** | M | Short-range lightning arcs, 7 × 2 per tick at 10/s, no reload | **Charged ball lightning** that can be "whipped" around corners (radius 320) | Energy ammo; range 1024 (768 from 1.4) | Ball cost 30, then 20 (1.4), then 25 (1.5.4) |
| **Ion Cannon** | H | Hitscan beam with falloff, 8×8×8 hull | Zoom | **120 close, dropping to 60 far** (256 to 2048 u), 2.5 s cycle | "Ion + machine pistol" is a standard finishing combo |
| **Minigun** | H | 3 flechettes × 12, 10 bursts/s, mag 100 | **Pre-spin** (audible, slows you) | Spin-up about 1–1.5 s | 1.4.1: 6 × 6 with more spread, slower while spinning. 1.5.5: knockback halved (experiment) |
| **Basilisk** | H | Auto "shotgun": 3 flechettes × 15, 3.33 rps | **Flak shell** (about 70 dmg, radius 256, costs 3 bursts) | Mag 12 (15 from 1.4) | — |
| **Rocket Launcher** | H | **Laser-guided rocket** with a brief lock-on (not on stealthers) | **Fly-by-wire**: steer with the movement keys via an on-gun screen/rocket cam; detonate mid-air | 115 + large explosion (radius 340), 1 rocket, 7–9 s reload | Rockets can be shot down. It was widely considered oppressive |
| **Katana** | L, M | Directional swings (left, right, forward) | **Block** (blocks katana strikes) | L 60 / M 75, about 1.4 swings/s | 1.4: faster block recovery |
| **Fatman Fist** | H | Hydraulic punch | — | 120, unblockable, launches props | — |
| **EMP Grenade** | L ×3 | Cookable | — | 35 dmg; disables implants, regen, HUD and hearing; **ejects deckers** | Not refilled by dispensers |
| **Frag Grenade** | M ×2 | Cookable | — | 105, radius 300 | — |
| **Spider Grenade** | H ×2 | Deploys a crawling mine that **hunts** the nearest visible enemy | — | about 91–93, radius 175, 15–25 HP (can be shot), ignores stealthers | 1.4: aimable throw |

- **Hitscan vs projectile:** Machine Pistol, Shotgun, Laser, Smartlocks, AR, MK-808, Tesla primary, Ion, Minigun and Basilisk primary are hitscan. Boltgun, GL, Tesla ball, Rocket, Basilisk flak and all grenades are projectiles.
- **Headshots** count only for the Boltgun, Laser, AR and MK-808 (×1.5).
- **Spread is not affected by movement** (a deliberate choice: "no Counter-Strike crouch lameness"). The one exception is the Minigun, which gets a small crouch bonus.
- **Energy weapons** (Laser, Tesla, Ion) never reload.
- **Deployables:** Dystopia had **no player-placed tripmines or deployable turrets** **[not found]**. Its equivalents are:
  - Spider grenades (autonomous seekers).
  - GL grenades and Boltgun bolts used as traps.
  - The Cortex Bomb.
  - **Map turrets that deckers can hijack**. "Deploying" defenses happens in cyberspace (ICE, mines).
  - The `dys_spidershooter` entity lets maps spawn spiders.

---

## 5. Cyberspace / decking in depth

### 5.1 Getting in and out
- You need a **Cyberdeck or Enhanced Cyberdeck** (Light or Medium only). Stand next to (or on top of) a **JIP** and press the implant key (usually F1); you are instantly transferred. Press it again to **jack out at any time**.
- **Minimum energy to jack in:** 15 (official wiki). [~ A 2020s community guide says 25 for the basic deck and 15 for the Enhanced.]
- **One decker per JIP**, so teams "tag-team" terminals. Some maps have JIPs in safe spawns, and others are exposed.
- **Your meat body stays at the JIP, immobile and fully vulnerable.** It keeps its HP and armor, is visible, and makes the JIP screen animate.
  - Counters: climb **on top of** the JIP by ledge-grabbing; have teammates guard you; or turn on **Stealth while decking**. That hides the body and freezes the JIP screen, but costs 1 + 0.25 energy/s.
  - Enemies kill deckers with melee (free), goombas, or **EMP grenades, which force-eject them**.
  - Heavies are the natural "JIP bodyguards".
- The JIP screen shows the decker's cyberspace view live to anyone in meatspace. From 1.4 the decker can hear nearby meatspace sounds through a "cyber microphone".
- **Jacking out:**
  - Voluntarily: no penalty.
  - Forced, because energy hit 0 from enemy fire: **"dumpshock" damage to health**, which scales with the remaining situation and can kill. The **JIP locks for several seconds**, so a teammate cannot immediately take over.
  - Guides therefore say: jack out *before* you get cyber-fragged if a backup decker is waiting.
- If the meat body dies while decked, the decker is removed. 1.5.5 hardened this flow: no "ghost meat bodies" and no half-decked states.

### 5.2 What cyberspace looks and feels like
- It is a **separate abstract 3D space built into the same map**. It is glowing, neon and Tron-like, with a bloom effect (toggleable from 1.4).
- Each map's network roughly mirrors the meatspace layout: "most cyberspace maps are a reflection of the meatspace map in some way".
- **Links / tubes:** long curved square tunnels "like fibers in a fiber-optic cable". They are **gravity-free**, with speed pads, and some push you along ("pushed with significant speed down the link" in Undermine).
- **Servers:** large hollow cubes with unique colour schemes. Usually one server covers the cyber features of one meatspace objective. As objectives fall, ICE colours change and open the path to the next server.
- **Nodes:** small "houses" inside servers, often Escher-like and convoluted. Their doorway can be sealed by ICE, and inside is a **push-button screen** that controls a meatspace device or objective. Scrolling text labels the node, and some screens show a live view of the meatspace area they control.
- **Gravity is relative (not true 6DOF flight):**
  - In links there is no gravity (free floating).
  - Entering a server sets a gravity direction.
  - Touching **grey gravity tiles** (`cyber_floor`) re-orients your personal gravity, so you can walk up walls and onto ceilings, and attack from new angles.
  - Later entities added `cyber_gravity_volume` and `cyber_gravity_align`.
- **Hazards and features:**
  - White **jump pads** (`cyber_jumppad`) and **speed pads**.
  - **Drain zones** that sap energy (`cyber_drain`; negative values heal).
  - Bottomless pits that eject you. "Water" also hurts; in the lore, "cyberwater" is slow memory.
  - **Cyber crystals** that restore energy (1.4 added placeable ones).
  - Shootable "frostwall" ICE (1.4 and later).
- **Movement:**
  - Much faster than meatspace, with **negligible friction**.
  - **Hold jump to bounce continuously and keep accelerating**, off floors, walls and ceilings.
  - Hold Shift to walk carefully, for example near Green ICE.
  - **Projectile-jump** (the cyber rocket-jump): fire the projectile under you, or at a tube wall behind you, for bursts of speed and height. Your own projectiles never damage you.
- **Visibility:** every decker leaves a **team-coloured light trail** (red Punks, blue Corps) that is **visible through most walls at long range** and fades when you stand still. This makes cyber fights about tracking and ambush.
- Cyberspace has its own ambient sound and effects: "cyber bubbles", decking trails, and jump/bounce sounds from 1.4.

### 5.3 ICE walls (static, map-placed)
- **Blue:** passable by Corps only. **Red:** Punks only. **Purple:** both teams. **Yellow:** neither.
- All ICE **blocks cyber weapon fire**, but **Projectile splash penetrates** it.
- Map ICE is typically flipped by capturing objectives. **Node ICE**, by contrast, can be created, wedged, or broken by programs (see 5.5).
- In 1.4 some ICE became "bullets pass through" (frostwall).

### 5.4 Energy in cyberspace ("energy is your life, your ammunition, and your construction resource")
- Decking drains **0.25 energy/s** passively.
- **Programs** consume energy over their run time; running several at once spikes the "netgraph" meter on the HUD.
- **Cyber weapons** cost energy to fire or charge. **Being hit drains your energy.** At 0 you are ejected (a "cyber frag" for the attacker).
- **Cyber crystals / shards:**
  - A decker who took cyber damage and jacks out, or is ejected, leaves a crystal at that spot. It is worth **half of the energy lost to enemy damage** and **decays over time**.
  - Anyone except the original owner can pick it up. Denying or grabbing crystals is key: jack out inside friendly ICE so enemies cannot reach yours.
  - Chaining kills can keep a decker in cyberspace indefinitely.
- **SCS** (a 75 pool) is effectively a 50% bigger HP bar in cyber. **Coldsuit** (1.4+) speeds recovery between dives.

### 5.5 Cyber combat
All three weapons have perfect accuracy.

| Weapon | Fire | Damage (to energy) | Rate | Notes |
|---|---|---|---|---|
| **Hitscan** | Primary (mode A) | 15 | 0.5/s (2 s recharge), costs about 2 energy | Unlimited-range instant beam with a 32 u hull. "Railgun." |
| **Shaft** | Primary (mode B; toggled with reload/scroll) | 1 per tick, 20/s | Continuous | Short-range beam that drains your own energy continuously. "Lightning gun." |
| **Projectile** | Secondary | 20 direct plus splash (radius 256) | 1/s | Fast explosive orb with knockback; passes ICE by splash; used for projectile jumps. "Rocket launcher." |

- Community guides describe cyber combat as "a bouncy Q3-style arena shooter" (railgun, lightning gun, rocket launcher). The early beta design had both attacks drain 15 per hit.
- A mine placed with the **ICE Mine** program hunts enemy deckers for **50 energy damage**, and can be shot down.
- In practice **most cyber fights are 1v1**, because teams are small and JIPs are few. Guides advise backing out of a 1v2.
- A cyber kill counts as a frag. From 1.4, cyber damage counts **×3 in stats** to rival meatspace.

### 5.6 Hacking programs
There are 11 hacking programs, plus 3 combat programs. The official site says "Thirteen cyberspace programs" [~ the counting method is unclear]. Programs are run by approaching a node screen or its ICE doorway and pressing the number key shown on the HUD (1–3 in later versions).

**Defensive (install protection)**

| Program | Target | Deck | Minigame steps | Effect |
|---|---|---|---|---|
| **Password Protect** | Screen | Both | 3 | Weakest lock. The enemy must run Password Cracker. |
| **Encryption** | Screen | Enhanced | 5 | Strong lock that overwrites Password. The enemy must run Decryptor. |
| **ICE Barrier** | Node doorway (set from the screen) | Enhanced | 6 | Seals the node for your team only. The enemy needs Wedge or ICE Breaker. Not every node allows it. |
| **ICE Alarm** | On ICE | Both | 6 | Alerts **all your team's deckers, in or out of cyberspace**, when the ICE is bypassed. Hidden after install unless scanned. |
| **ICE Mine** | On ICE | Enhanced | 7 | Triggers on **Wedge**. A homing mine chases the nearest enemy decker for 50 energy. Can be shot down. |
| **Green ICE** | On ICE | Enhanced | 6 | Triggers on **touch or on ICE Breaker completion**. It immobilises the intruder, then **force-ejects** them with an EMP effect (implants and regen disabled), but no energy damage. Incompatible with Alarm and Mine (per a community guide). |

**Offensive (break protection)**

| Program | Target | Deck | Minigame steps | Effect |
|---|---|---|---|---|
| **Password Cracker** | Screen | Both | 2 | Removes Password Protect. |
| **Decryptor** | Screen | Both | 4 | Removes Encryption. It takes longer. |
| **Wedge** | ICE | Both | 2 | **Temporarily** opens ICE (about 5 s); you can get stuck inside when it closes. Very fast and cheap. Triggers ICE Mines; ignores Green ICE if you do not touch it. |
| **ICE Breaker** | ICE | **Enhanced** | 5 | **Permanently** removes ICE and disables Mines, but trips Alarms and **Green ICE on completion**. Needed before you can install your own ICE. |
| **ICE Scan** | ICE | Both | 2 | Quickly reveals Mines and Alarms, and **safely deletes Green ICE**. |

- **Enhanced Cyberdeck minigame** (a "Simon says" speed layer):
  - While a program runs, its named sub-steps appear in order at the top, for example Encryption is "Packet Encapsulator, Key Escrow, Integer Library, Skipjack, Blowfish".
  - Matching buttons appear below in **randomized positions**. Pressing the right sequence cuts run time **up to 50%**, and energy cost with it. Mistakes slow the program down.
  - The per-program sequence is fixed, so experts memorise it. A community guide gives about 100% time with no input, about 80% when reading and clicking, and about 50% when memorised.
- **Tempo trade-off:** hack fast (just press the button) versus fortify (spend energy and time layering Encryption, ICE, Mine or Alarm to slow the enemy decker). Enemy projectile spam can interrupt minigame play.
- The Enhanced deck costs **one more head slot**, which for a Medium means giving up Thermal Vision. It matters for **defending** nodes. The basic deck is "just as good" on unprotected objectives or destroy-in-cyber objectives, because combat is identical.

### 5.7 How cyberspace affects meatspace (catalogue from official maps)
- **Turrets:** switch ownership so they attack the enemy (Vaccine stairs, Silo tunnels), or toggle them on and off (Assemble hallway, Fusion reactor).
- **Doors, hatches, vents, bridges, lifts:** open or close routes and shortcuts. Examples:
  - Vaccine dock and back doors and maintenance hatch.
  - Fortress bridge extension.
  - Broadcast sewer elevator, fire escape, ventilation, and spawn elevator power.
  - Silo vent fans and electric fence.
  - Injection maintenance shaft.
  - Undermine gas tunnel.
- **Spawns:** capture forward spawns (Vaccine middle spawn, Silo internal spawn, Detonate spawn power), including "rematrixing" the elevator spawn on Cybernetic.
- **Security systems and shields:** drop turret-and-force-field packages (Vaccine core, Detonate security), transformer shields (Cybernetic), and server defences (Broadcast).
- **Traps:** gas leaks and broken pipelines (Silo), steam traps, a mechanical arm (Cybernetic), and the mining laser (Undermine).
- **Teleporters:** keep control of them (Fusion, Cybernetic).
- **The objective itself:**
  - Destroy the cooling door *inside* cyberspace (Detonate).
  - Capture the spawn by pushing a cyber button.
  - Launch the missile (Silo).
  - Upload or transmit data (Assemble, Exodus).
  - Locate the profile minigame (Cybernetic).
  - EU power nodes (Undermine).
  - Collect data chunks and craft viruses to carry into meatspace (Coast).
- **Meat affects cyber too:**
  - Undermine's EU panels flip cyber ICE ownership.
  - Broadcast's firewall-port button changes cyber tube access.
  - Injection's 4-digit code is read in meat and used in cyber.
  - Undermine EU rooms allow **only one decker per team**.
  - In 1.4, a safe in-spawn JIP on Broadcast was set to **disable when the enemy jacks into the objective JIP**, to prevent "node camping".

### 5.8 Design history of cyberspace (why it is the way it is)
- Lead coder Teddy in 2005: *"Cyberspace was particularly challenging, partly because of the complicated physics, but also it had never been done before so we really didn't know what style of gameplay would work. It took us about **7 versions of cyberspace** till we settled on the **fast paced deathmatch with a simple energy management game** that's in the demo. There were times we thought cyberspace wasn't going to work."*
- Mappers received a **"tubekit"** prefab set for building cyberspace. It is built with regular Source brush entities: `cyber_ice`, `cyber_floor`, `cyber_gravity`, `cyber_jumppad`, `cyber_speedpad`, `cyber_drain`, `dys_cyberscreen` (with a spawn protection level of none, Password or Encryption), and `dys_jackpoint`, which links a meat brush to a cyberspace `point_camera`.
- Later additions: **1.3** particle trails and bubbles. **1.4** radial damage indicators in cyber, cyber sound effects, crystals as pickups, meatspace **cracking** (so deckers can act without jacking in), anti-node-camping JIP logic, and map-by-map reworks toward "more emphasis on controlling cyberspace".
- **Common role pattern:** "each team only really needs around 1–2 hackers; the rest defend the hackers and storm objectives." Heavies cannot deck at all.

---

## 6. How it was made

### 6.1 Timeline

| Date | Event |
|---|---|
| ~2000–2001 | **T'lexii** writes the original design doc for a **Quake 3** mod. It is shelved because the Q3 engine "couldn't do everything required". |
| Aug 2002 (ModDB Q&A) / after E3 2003 (Gamecloud) [~ sources conflict] | Project revived for Valve's **Source** engine. The E3 2003 tech demo was "basically a shopping list of what we required". |
| Mid-2003 | Core team assembled, mostly Australian (Brisbane). Gameplay **prototyped in HL1** until the HL2 SDK arrived. dystopia-mod.com launched Nov 2003. |
| Dec 2004 to Sept 2005 | About 9 months of full development on the HL2/Source SDK. Teddy learned C++ on the job, writing roughly 100k lines in 2 years. |
| 14–20 Feb 2005 | **Valve flies three members from Australia to Seattle** (a fourth came from Chicago). They spend a week at Valve's offices with 3 playtests; Valve keeps testing the closed beta. |
| 2005 | Shown at the Australian FreePlay conference and Tech Ed (Gold Coast), and to Valve and Microsoft. |
| **9/10 Sept 2005** | **Public demo** with **dys_vaccine** only (the date differs by timezone). Demo updates u1 (16 Sep), u2 (28 Sep), u3 (16 Oct). ModDB Originality Award (Aug) and Mod of the Month (Oct). |
| Late 2005 | ModDB Mod of the Year 2005: **Best Action Mod, 3rd overall**. |
| 8 Jan 2006 | Demo **Update 4**: adds dys_silo and dys_fortress. **IGF 2006 Modding Competition: Best Mod for Half-Life 2**. |
| **24/25 Feb 2007** | **Version 1.0**, "after 3 years of development": tutorial, more maps (e.g., Undermine), Phistball, stats and an MP3 player. |
| 17 Mar 2007 | v1.1. Steamfriends 2007 Bronze award for best Source mod. PC Zone Top-5 mod of 2007. |
| 2007 | **Puny Human** formed as the "spiritual continuation" of Team Dystopia (Raleigh, NC). |
| **6 Feb 2009** | **v1.2 released via Steamworks**, one of the first 7 Steamworks mods. Release party broadcast with djwheat. Content updates 1.21, 1.22 and 1.23 through mid-2009. |
| 14 Sept 2010 | **v1.3**: ported to **Source SDK 2007 (Orange Box)**, HDR, rewritten core systems, Fusion made official, Steam achievements. Beta went first to paying "Supporters" (May 2010). |
| Oct 2010 | Puny Human reveals **Blade Symphony** (formerly "Project Berimbau"; released 2013 per Puny Human, Steam Early Access, then full release [~ 2014]). Dystopia development slows. |
| 12 Dec 2013 | **v1.4**: port to **Source SDK 2013** and a big balance and map pass (Coast, crackables, crouch slide, SWT overhaul). |
| 23 Aug 2014 | v1.4.1: 14 third-party maps added to the build, Steam Cloud. |
| 2014 / 2016 | Valve SDK Base updates break the mod; fixes and workarounds follow ("Valve Broke Dystopia Again"). |
| 14 Feb 2018 | **v1.5.0**: removes the Source SDK Base dependency. Puny Human **licensed the Source engine** to ship Dystopia as a **free standalone** game with a **Linux client**, funded by Patreon. 1.5.1 and 1.5.2 follow within days. |
| 7 Nov 2020 | v1.5.3: newer engine networking and physics, experimental **Vulkan**, **64-player max**, DX8 dropped. |
| 6 Jan 2023 | v1.5.4 (balance, Coast rework, Discord presence, FOV up to 120). |
| **3 Oct 2023** | **Puny Human announces layoffs and near-total closure** after a client withheld payments; it goes from 20 staff to 0. |
| Jul–Aug 2026 | Surprise revival of maintenance by Mike "urinal-cake" Sanders: new **dystopia-stats.com**, then **1.5.5** (community fixes, 128/256-tick servers, Smartlock rework experiment), **1.5.6** (31-language localisation, damage numbers, a credits screen listing **215 contributors**), and **1.5.7**. |

### 6.2 People
- **Founders:**
  - **Robert "Fuzzy" Crouch:** project manager and PR lead, Brisbane, a university sysadmin by day.
  - **Dustin "Teddy" Hulm:** lead programmer and co-manager.
  - **Tim "Termi" Grant:** lead level designer. Made Vaccine, Silo, Assemble and Injection.
  - **Caliban:** lead artist and third manager. He and several 3D artists (CrystalMesh, Xodustyle, Church) came from **Krome Studios / The Creative Assembly Australia**.
  - Original design doc by **T'lexii**.
- **Other early leads:** Graincloud (audio) and Noip (QA). **Epicar** (Casey Bodley, US) was the graphics-effects coder behind the IFF and SWT HUD effects.
- In 2005 Fuzzy described "managing a team of 20 people via the internet". Working across AU and US timezones gave "24 hour" progress.
- **Later (US) era:** **Michael "urinal-cake" Sanders**, lead producer and later Puny Human CEO/studio manager, based in North Carolina.
  - The 2010 wiki roster lists management (Sanders, Termi); programming (Hyphen-ated as lead, Marcel Lamm aka Atomy, Casey Bodley aka Epicar, Mandibull); audio (bioxeed, AngryNerd, Sverek); and art/level design (Termi, Spire, Lez, Venciera, Feanix, Twincannon, charlestheoaf, rabidpenguin and others).
  - The team coordinated **"on IRC all day, 6–8 hours per day"** plus Ventrilo, funded by donations and supporter packages.
- Third-party mappers were regularly **hired into the team**: Twincannon (Fortress), Feanix (Broadcast/Radioshack), Venciera (Cybernetic via the Dystopia Competition), and Fedio (Fusion).

### 6.3 Technology and technical challenges
- **Engine:** Valve Source, first as an HL2 mod on Source SDK Base (2004 era), then Orange Box/SDK 2007 (1.3), then SDK 2013 (1.4), then a licensed standalone Source build (1.5).
- **Why Source** (Fuzzy, 2005): the camera system, "wide range of shader effects and bleeding edge graphics", Valve's track record of supporting the SDK, stable network code, and the chance of **Steam distribution**.
- **Challenges they named:**
  1. **Cyberspace** needed its physics (relative gravity, gravity-free links, bouncing) and game design reinvented about 7 times.
  2. "**Bending the Source engine** into doing a lot of things that weren't used in Half-Life 2 or Counter-Strike: Source."
  3. Professional-quality character and weapon art took a long time.
  4. Managing a 20-person remote team, mostly amateurs (Teddy's first C++ project).
  5. **Balance across maps.** About 3 months before the demo they **froze all maps except Vaccine** and evolved gameplay on it as the "base normal" level. Changing a weapon for one map broke another, and even leg-boost jump height rippled through level design.
  6. Later, **platform fragility**: the Source SDK Base dependency broke on Valve updates, "Source SDK Base" showed as the game in Steam friends lists, dedicated servers were fragile, and the Hammer SDK 2013 hit brush limits. This led to licensing Source in 2018. The license **prevents open-sourcing Dystopia** (Zero Day FAQ).
- **Netcode:** a prediction-code rewrite (Phistball came out of testing it), lag-compensation fixes through 1.5.5, and high-tickrate support in 2026.
- **Other systems:** a global stats system (from 2005; rebuilt 2009, 2023 and 2026), XFire integration (2009, removed 2020), Steam achievements (1.3), a whitelist for custom content, SourceTV for competitive shoutcasts, and a tutorial map ("Lobby") with voice-acted guidance added at v1.

### 6.4 Reception, awards, numbers
- **Awards:** ModDB Originality Award (Aug 2005), Mod of the Month (Oct 2005), MOTY 2005 Best Action Mod and 3rd overall, honourable mentions in 2006 and 2008 (plus a 2008 art-direction nomination), **IGF 2006 Best Mod for Half-Life 2**, and Steamfriends 2007 Bronze.
- **Press:**
  - PC Gamer #149 (2005): "Enemy Territory in Dredd's Mega City One".
  - PC Powerplay (2006, 2010).
  - PC Zone #181 (2007): "not instantly accessible, but it makes sense, it works and it's a lot of fun"; Top 5 mods of 2007.
  - Destructoid (2007): "everything that Microsoft's Shadowrun hopes to be".
  - Planet Half-Life: "the first real quality Half-Life 2 mod".
  - Good Game (ABC TV, 2006) and RPS "Have You Played" (2016).
  - CD Projekt Red's Cyberpunk 2077 designer Damien Monnier used Dystopia in the blog post "Recipes for kick-ass cyberpunk games" (ingredients: Cyberspace, Maps, Implants).
- **Downloads (pre-Steam):** 200k+ from FileFront, 125k+ from FilePlanet, 40k+ from XFire, 10k+ from FileShack (Wikipedia).
- **Players:** the stats system's **all-time peak is 653 concurrent (about 2009)**. It records 23,000+ players and more than a million kills since 2009.
  - Community-run pubs have 16–30 players on scheduled evenings (2021–25). Steam reported **13 concurrent players** at the time of writing (a Saturday).
  - Steam reviews: English 741 positive / 87 negative, "Very Positive". All languages: about 972 positive / 168 negative.
- **Competitive scene:** the Dystopia Global League (DGL, 2008–2010, 5v5 ladder, Nations Cup), plus later PUG groups and "getDRAFTED" tournaments (2015 "Decade of Dystopia", 2021–2023).

### 6.5 Afterlife, sequels, and successors
- **Puny Human** made Blade Symphony (2013 per Puny Human) and Galacide (2015, UE4), then from 2016 worked mostly as an engineering co-dev vendor (Bard's Tale IV, Trover, Tribes of Midgard, The Callisto Protocol, Wasteland 3). It closed in Oct 2023 and said it would sell some IP. Dystopia itself was still getting patches in 2026.
- **"Dystopia 2" (DYS / DYS TEAM):** started around **2016** by **Termi** and original developers, separate from Puny Human.
  - Plan: **UE4**, **free to play**, funded via Patreon, "dual world gameplay between the real world and the underlying data networks".
  - Concept art such as the Corp Medium armor and helmet was posted.
  - By 2017–19 the site said only "development continues, no public announcements", with credits "Development: Wetwired Media; Original Game Design: Dustin Hulm, Robert Crouch, Tim Grant". The site has been unchanged since. **Status: dormant/unknown.**
- **Zero Day (Puny Human):** begun **2018**, teaser Apr 2019, UE4. It was described as between a successor and a spin-off.
  - Genre: a "cyberpunk-themed, objective-driven collaborative looter-shooter / bounty-hunting" game, "dual-layer persistent shooter".
  - Design: **5 teams** start at the map edges, fight AI and each other, loot credits and materials to craft armor, weapons and implants, converge on the "Zero Day object", and **extract**. It has meatspace and cyberspace, and consciousness transfer between bodies and androids.
  - It started as a hero-shooter concept and was dropped.
  - Puny Human sought VC funding by Q2 2023; the project was effectively ended by the closure.
- Notable design takeaway from Zero Day's pitch: its devs called Dystopia's **objective-driven** structure "our favorite feature that made Dystopia unique".

---

## 7. What players loved, and what they criticized

### 7.1 Loved
- **The dual layer and its interplay.** Hackers flip turrets and open routes while the meat team pushes, and stealth Lights hunt enemy deckers' bodies. "Meatspace and cyberspace complement each other just as you'd dream" (RPS). Every reviewer names it as *the* feature.
- **Teamwork and wave spawns.** "You spawn as a team, you survive as a team." Coordinated waves, TAC calls and medic pairs reward organisation. It is excellent for 5v5 competitive play.
- **Loadout freedom and counterplay.** Class plus weapon plus implants, compared favourably to TF2's fixed templates: "choose abilities tailored to one's personal playing style, rather than simply having to accept a whole template". The web of detection and stealth counters creates mind games.
- **Distinctive weapons.** The Boltgun, Smartlocks (lock-on tracers), Tesla ball "whipped around corners", laser-guided and fly-by-wire rockets, the charge-timed Laser Rifle, the Ion Cannon, and katana duels with blocking.
- **Movement.** Leg-boost bunny hopping, ledge grabbing, goombas, and projectile jumps in cyber. It is fast and very high-skill.
- **Cyber combat itself**, which experienced players describe as a "bouncy Q3-style arena" with real skill ("there is actually some kind of skill in cyberspace too").
- **Atmosphere and polish.** Commercial-grade art for a free mod, skyboxes, a techno soundtrack, map-specific set pieces (the Undermine laser, the Silo launch), hitbeeps, and awards.
- **Map variety**, with unique objective concepts per map: escort, profile minigame, launch countdown, DNA capture, virus injection.
- **A loyal, helpful core community** that has kept pubs, PUGs and tournaments alive for 20 years.

### 7.2 Criticized
1. **Learning curve and inaccessibility** (the number one complaint in every era).
   - "Confusing at first" (Fuzzy, 2005). "Chief problem… difficult for new players to get a hang of all the map objectives, the way the weapons work, turning on and off implant abilities, and understanding the lingo (What is a TAC scan…?)" (PHL, 2007).
   - "Explaining any one [map] usually requires 30 minutes and a couple of whiteboards… explaining how something as simple as the respawn timer works still involves a lecture" (Steam review).
   - The tutorial was criticized for not covering combat or most implants, and the loadout menu for giving too little time to read.
2. **Cyberspace was opaque and exclusionary for newcomers.**
   - "Cyberspace, an extremely important part of the game, is extremely unintuitive and nearly unplayable" (new player).
   - "Movement and combat in cyberspace is extremely different… If there is a more experienced decker nearby, let him jack-in instead" (official wiki).
   - Only **1–2 deckers per team** matter, one decker per JIP, and the decker's meat body sits helpless. Deckers depended on others, and others sat waiting on them.
   - Good deckers dominated (the early community wiki describes double-Corp-decker lockdowns that left the rest of the team "hanging around doing nothing for the entire round").
   - Devs later added meat "cracking", anti-camping JIP rules, and simplified cyber geometry.
3. **Map design: chokepoints, bottlenecks, darkness, and navigation.**
   - "Really badly bottle-necked… your entire team is trying to get through [one tiny doorway]" (2005).
   - "A lot of spammy chokepoints and a lot of waiting" (RPS).
   - "Map design is esoteric… needs Batman-style guiding lights on the floor" (366-hour player).
   - "Levels are generally dark, mazelike and lack recognisable landmarks", and decorative screens are indistinguishable from usable ones.
4. **Balance.**
   - Lights "don't really stand a chance against the heavies… there should be some sort of limitation on class choices" (2005).
   - "The rocket, dual smart locks, and boltgun remove fun from the game". Grenade-launcher spam. Stealth plus katana plus cortex-bomb griefing in pubs ("nobbers running around cloaked swinging cyberswords then detonating their cortex bombs").
   - Leg-boost bhop "completely changed the dynamics of the game and broke map design".
   - The assault rifle's shifting alt-fire. "Class loadout whoring" slowed objectives (games.on.net).
   - Constant rebalancing (katana, smartlocks, minigun, shotgun reverted) shows the devs struggled too.
5. **Waiting and downtime.** Wave timers that can reach a minute after a team wipe, JIP queues, and the passive meat body while decking.
6. **UX friction.**
   - Implant hotkeys (F1–F5) **change with the loadout**.
   - No kill assists (at v1).
   - Unreadable menu text colour on the Punk theme.
   - An ear-splitting EMP and Heavy audio.
   - Armor cannot be repaired, and you do not spawn with full reserve ammo.
7. **Population and community problems.**
   - "Dead game" is the dominant negative review theme after about 2012 (no bots worth playing, no single-player).
   - Griefers and slow moderation. Aimbots. An elitist veteran pub scene that "wrecks" newcomers ("some LR pro who never stopped playing coming by to wreck everyone").
8. **Technical issues.** Valve updates breaking the mod (2014, 2016), crashes, spawn-bug crashes before 1.2, lag compensation and netcode regressions, and HL2-era installation dependencies before 2018.

### 7.3 How the devs responded over time (useful precedents)
- **Onboarding:** a tutorial map (v1), loading-screen hints, default presets, floor arrows and "helper" pop-ups, objective HUD markers with off-screen indicators (1.4), and a recommended beginner loadout (Medium AR + TAC + Mediplant).
- **Waiting:** spawn timer capped at 18 s, and 5 s idle when nobody is dead (1.4).
- **Cyber accessibility:** meatspace cracking, the "Toggle Screen" pattern (one button both teams can press), safe spawn JIPs with anti-camping rules, simpler cyber geometry, and turrets moved to protect or expose deckers.
- **Readability:** SWT overhaul, team-coloured projectiles and beams, IFF improvements, damage numbers (2026), per-team crosshairs, and colour-blind-friendlier UI (2026).

---

## 8. Design notes for a sequel (my analysis, not sourced fact)

1. **Keep:**
   - The dual layer with **mutual dependency**: meat protects the body and flips panels, cyber flips turrets, routes and spawns.
   - Slot-budget implants with a shared energy pool and hard counters.
   - Wave spawns with class-weighted penalties.
   - Per-map bespoke objective chains. The alt-fires that change a weapon's role.
2. **Fix the decker bottleneck:**
   - More simultaneous cyber participation (multiple entry points, or remote/partial hacking from meatspace in the spirit of 1.4's cracking).
   - A reason for non-deckers to care about cyber state (visibility of nodes on the meat HUD).
   - Make the meat body less of a pure liability (e.g., a timed shell, a partial-awareness "cyber microphone" plus warning pings).
3. **Onboarding debt was the killer:**
   - Consistent iconography for usable vs decorative screens, and fixed implant keybinds.
   - In-world map guidance, readable objective explanations, and bots or PvE for low-pop hours (Zero Day moved toward PvE for a reason).
4. **Chokepoint design:** Dystopia's routes were frequently gated by cyber. Designing 2–3 meaningful routes per objective (the 1.4 map passes kept adding them) reduced stalemates.
5. **Avoid movement tech invalidating level design:** bhop/leg-boost interacted badly with maps built earlier. Decide the movement ceiling first, as the devs themselves did by "locking" gameplay on Vaccine before building other maps.

---

## 9. Open questions / not verified
- Exact **current (1.5.x) class values**: Heavy armor 100 vs 200, Heavy slot counts after 1.3, and whether Medium/Light values changed. The best sources are the in-game loadout screen or `scripts/` files of an installed build.
- The exact **energy regeneration rate** (derived as about 2/s) and **Thermal Vision** drain.
- **Default round time** (community says "up to 20 min").
- **The minimum energy to jack in** (15 per the wiki vs 25 basic / 15 enhanced per a community guide).
- Which **maps shipped in which release** between v1.0 and 1.2 (Detonate, Assemble, Broadcast, Exodus).
- **dys_fixation / dys_escape / dys_road:** not found anywhere.
- The **"Thirteen cyberspace programs"** count vs the 11 hacking plus 3 combat programs documented.
- Note: a joke "March update" news post on the 2009 site (level-ups, crits, microtransactions) is satire, and was **not used**.

---

## Sources

**Official / primary**
- Official site: https://dystopia-game.com/ and https://dystopia-game.com/newplayerguide.php
- Official Dystopia Wiki (read via its MediaWiki API): https://wiki.dystopia-game.com/
  - Overview: https://wiki.dystopia-game.com/index.php?title=Dystopia_Overview
  - Classes: https://wiki.dystopia-game.com/index.php?title=Classes · Light / Medium / Heavy Augmented Armor pages (e.g. https://wiki.dystopia-game.com/index.php?title=Heavy_Augmented_Armor)
  - Implants: https://wiki.dystopia-game.com/index.php?title=Implants plus the individual implant pages (Cyberdeck, Enhanced_Cyberdeck, Stealth, Coldsuit, Mediplant, Leg_Boosters, Sound_Suppressor, Wired_Reflexes, Superconductor_Capacitor_Storage_(SCS), TAC_Scan, Thermal_Vision, Sound_Wave_Triangulator_(SWT), IFF_Info, Cortex_Bomb)
  - Weapons: https://wiki.dystopia-game.com/index.php?title=Weapons · Damage table: https://wiki.dystopia-game.com/index.php?title=Damage_Table · Spread · Hitscan_and_Projectile · Armor_system · per-weapon pages
  - Cyberspace: https://wiki.dystopia-game.com/index.php?title=Cyberspace_Navigation · https://wiki.dystopia-game.com/index.php?title=Cyberspace_Interaction · Cyberspace_(fiction)
  - Systems: Spawn_System · Spawn_points · Devices · Heads-Up_Display · Server_Variables · Respawn_Platforms (lore) · Vehicles
  - Mapping entities: cyber_ice, cyber_floor, cyber_gravity, cyber_jumppad, cyber_speedpad, cyber_drain, dys_jackpoint, dys_cyberscreen, dys_objective, Adding_Jack-In_Points, Toggle_Screens
  - Maps: Official_Maps and the *_Info / *_Walkthrough pages for Vaccine, Silo, Fortress, Undermine, Detonate, Assemble, Broadcast, Cybernetic, Exodus, Injection, Fusion
  - Team_Dystopia · Press · Competitive_Play · Changelog (1.5.5)
- Steam store: https://store.steampowered.com/app/17580/Dystopia/ · Steam news: https://store.steampowered.com/news/app/17580 (1.4, 1.4.1, 1.5.0–1.5.7, stats site, Zero Day teaser, "A decade of Dystopia", 2009–2010 posts)
- 1.4.1 changelog (dev post): https://steamcommunity.com/app/17580/discussions/0/34095684598888241/
- 1.4 changelog (on ModDB, archived): https://web.archive.org/web/2016/https://www.moddb.com/mods/dystopia
- Archived official news (2009–2010), including the 1.23 changelog and the 1.30 changelog draft:
  - https://web.archive.org/web/2011/http://www.dystopia-game.com/news/june_09_update_-_june_is_heating_up/18541
  - https://web.archive.org/web/2011/http://www.dystopia-game.com/news/november_09_update_-_the_future_is_orange/19648
  - https://web.archive.org/web/2011/http://www.dystopia-game.com/news/april_09_update_-_shifting_back_into_gear/18176
  - https://web.archive.org/web/2011/http://www.dystopia-game.com/news/recognition/6144
- Stats: https://dystopia-stats.com/ and https://dystopia-stats.com/classes

**Interviews / history**
- ModDB "Dystopia Q/A" (Fuzzy): https://www.moddb.com/mods/dystopia/features/dystopia-qa (read via web.archive.org)
- Gamecloud interview with Fuzzy (Sept 2005): https://web.archive.org/web/20051103190501/http://www.gamecloud.com/article.php?article_id=1493
- Amped DX interview with Fuzzy and Teddy (2005): https://web.archive.org/web/20061109085853/http://dx.ampednews.com/?page=articles&id=11712
- GamesIndustry.biz "Not Such a Perfect World" (Mike Sanders, 2009): https://www.gamesindustry.biz/articles/not-such-a-perfect-world
- Noesis Interactive interview parts 1–3 (videos): https://www.moddb.com/mods/dystopia/features/noesis-presents-dystopia-interview-part-1 (and -part-2, -part-3)
- Good Game (ABC, 2006): https://www.abc.net.au/tv/goodgame/stories/s1757266.htm
- Wikipedia: https://en.wikipedia.org/wiki/Dystopia_(video_game)
- Fandom wiki (beta era; history and cut features): https://dystopia.fandom.com/wiki/Classes · /wiki/Implants · /wiki/Weapons · /wiki/Cyberspace · /wiki/Previous_Team_Dystopia · /wiki/CAQ (read via its API)
- Puny Human closure press release (Oct 2023): https://punyhuman.com/closure-press-release/
- Zero Day: https://playzeroday.com/ · https://playzeroday.com/faq/ · https://playzeroday.com/what-how-and-who-is-zero-day/ · https://playzeroday.com/creating-zero-days-ion-cannon/
- Dystopia 2 (DYS TEAM), archived: https://web.archive.org/web/2016*/dystopia2.com (FAQ, Patreon page, 2019–2025 homepage)
- CD Projekt Red blog coverage: https://rpgwatch.com/news/cyberpunk-2077--recipes-for-kick-ass-cyberpunk-games-20882.html

**Reviews / player opinion**
- Planet Half-Life v1 review (2007): https://web.archive.org/web/2008/http://planethalflife.gamespy.com/View.php?view=HLMotw.Detail&id=191
- Planet Half-Life v1 preview (2007): https://web.archive.org/web/2007/http://planethalflife.gamespy.com/View.php?view=Previews.Detail&id=75
- games.on.net "The Mod Squad – Dystopia 1.3" (2010): https://web.archive.org/web/2011/http://games.on.net/article/10252/The_Mod_Squad_-_Dystopia_1.3
- Rock Paper Shotgun "Have You Played… Dystopia?" (2016): https://www.rockpapershotgun.com/have-you-played-dystopia
- Bordersdown forum launch thread (2005): https://bordersdown.net/forum/gaming/get-answers-games-and-tech/19789-dystopia-hl2-mod
- ModDB reviews (archived): https://web.archive.org/web/2016/https://www.moddb.com/mods/dystopia/reviews
- Steam user reviews (about 1,140 read via the store review API): https://store.steampowered.com/app/17580/Dystopia/ (Reviews)
- Steam community guides:
  - "Dystopia Basics": https://steamcommunity.com/sharedfiles/filedetails/?id=2578500271
  - "Dystopia Pro Guide Twenty Twenty Six": https://steamcommunity.com/sharedfiles/filedetails/?id=306559857
  - "Winning Your First Game": https://steamcommunity.com/sharedfiles/filedetails/?id=130471924
  - "Dystopia Rummagingbox" (history, timeline, Dystopia 2): https://steamcommunity.com/sharedfiles/filedetails/?id=2720798729
  - "Dystopia Maps": https://steamcommunity.com/sharedfiles/filedetails/?id=2603647391
