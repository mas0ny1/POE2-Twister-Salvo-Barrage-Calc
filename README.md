Twister - Salvo Support - Barrage Simulator (Path of Exile 2)
==========================================================

Web app to visualize and approximate Path of Exile 2's Twister projectile behavior and DPS. Runs entirely in the browser using a single HTML page, CSS, and vanilla JavaScript.

FULL CREDITS TO THE ORIGINAL AUTHOR WHICH CAN BE FOUND HERE: https://github.com/ImVexed/spark-calc
This code is heavily modifed the behaviour aspects of the calc, but all the UI elements etc are built on top of ImVexed's work.
A lot of the modifications were assisted by AI, implementation/design decisions may not be amazing, but functionality was prioritised.

Current assumptions for Twister behavior: https://poe2db.tw/Twister
------------------------------------------
- 10 Units is equivalent to 10 Meters. (Confirmed by Zao on PoB Community Developer Discord)
- Twister base speed is 75 units per second (from POE2DB)
- Twisters are shot in random directions because we are using "Salvo Support" (https://poe2db.tw/Salvo), This means they have a "cone" or "angle" of 360 degrees
- Boss radius is 3 units (This is the unit of measurement for Maven from Path of Exile 1 and was left as default)
- Default Circle Arena is 160 units in radius (This is Maven's Arena size in POE1 and was left as default)
- Twisters are 0.5 units (meters) in radius (from POE2DB)
- Twisters travel in straight lines with no jitter pathing changes

Quick start
-----------
- Option A: Open `index.html` directly in a modern browser.
- Option B: Serve locally (recommended):
  - Python 3: `python3 -m http.server 5173 --directory .`
  - Open `http://localhost:5173/`.

Repository layout
-----------------
- `index.html` — App shell and UI
  - Side panel with grouped controls (Arena, Skill & Projectiles, Casting, Behaviors, Enemy, Simulation, Charts)
  - Canvas stage for the 2D simulation
- `style.css` — Visual styling
  - Dark theme, card layout for the side panel
  - Responsive grid for form fields and sparkline chart styling
- `main.js` — Simulation and UI logic
  - World-units model with dynamic pixel scaling
  - Arenas: Circle, Square, and corrected hollow T‑Junction
  - Entities: caster (draggable), boss/enemy (draggable)
  - Straight-line projectile movement
  - Projectile lifecycle, continuous collision detection against the boss, and terrain reflection
  - Enemy‑only behaviors with correct priority and single-operation per hit
  - Metrics capture and charts with configurable time window
- `coordinates.csv` (optional/dev) — Sample tracked coordinates data
- `track.py` (optional/dev) — Helper used to process tracked data (not required to run the app)
- `video.mp4` (optional/dev) — Reference video used for motion/heading tuning

Controls (side panel)
---------------------

- Simulation
  - Arena Layout: Circle, Square, T‑Junction
  - Start / Stop / Reset (Self Explanatory)
- Skill Behaviour
  - Base Projectiles (Set to 4 as Default, 1 from Twister, 3 from Stage 3 Whirling Slash)
  - Base Projectile Speed (units/s)
  - Twister Radius (units or meters)
  - Duration (seconds)
  - Base Seal Gain Frequency (/s) — how fast seals accumulate (default 0.5 = 1 seal per 2 seconds). As Per the Salvo Support gem: Supported Skills Accumulate a seal every 2 seconds
- Character Stats
  - Average Hit (Use Path of Building 2 to get this value)
  - Increased Projectile Speed (%) (Can be found in game using the Gem tab Pop-out/Advanced Information for Twister, or in Path of Building 2)
  - Increased Seal Gain Frequency (Can be found by adding together the amount of this stat you have across your character, generally from skill tree only)
  - Max Seals (Set to 3, currently there is no ways to increased this value)
  - Current Seals (This is a live counter for the number of seals your character has, it is updated live when you click "Start")
- Character Behavior
  - How many seals do you wait for (pretty self explanatory)
- Enemy
  - Enemy Radius (units). Default 3 units (boss-sized for POE1)
- Charts
  - Chart Timescale: 5s, 10s, 30s, 60s, 120s
  - Sparklines: Hits (total), Hit Rate (/s), DPS, Total Damage, Projectiles Alive

Mechanics modeled
-----------------
- Salvo gem mechanic: Twisters accumulate seals over time (default 1 seal per 2 seconds) up to a maximum (default 3)
  - When max seals are accumulated, the skill fires all projectiles at once
  - Fire count = base projectiles + (2 × number of seals consumed)
  - All seals are consumed when firing
- Twisters move in straight lines with no steering or jitter
- **IMPORTANT: Per-cast per-target hit cooldown: 0.66 s. Other projectiles from the same cast pass through during the cooldown
  - This has been modified to the following behaviour due to Twister and Salvos Interactions. Projectiles fired are grouped into the following "hit groups", all projectiles from a hit group can only hit the same target once every 0.66 seconds, as written on the gems. The hit groups are seperated as follows:
   1. Twister's base 4 projectiles
   2. Salvo's 2 Additional Projectiles, are treated as seperate hit groups per seal. You can test this by setting "How many seals do you wait for" to 1, then overlapping both the caster and the boss. If you watch the "Hit (total)" value in Charts, it will go up by increments of 2, as the base 4 projectiles are hitting, then the 2 from Salvo are treated as a group and hitting. Therefore there are only 2 counted hits. This Behaviour is also how Barrage is implemented, where each repeat from Barrage is treated as a seperate "hit group".**
- Projectiles bounce off walls/arena boundaries and ignore the caster
- Duration ends a projectile.
- Continuous collision detection (CCD) against the boss prevents tunneling between frames

Arenas
------
- Circle: radius = 160 units (world units mapped to pixels dynamically)
- Square: size matches the circle’s diameter for consistent scale
- T‑Junction: hollow T corridor with top margin; stem connects into the bar without a blocking wall

Developer notes
---------------
- World units and scaling: inputs are in world units; a scale factor maps world units to pixels based on canvas size
- Timing: fixed‑timestep physics at 120 Hz; UI charts sampled every 200 ms and trimmed to the selected window
- CCD: enemy collisions use swept circle tests; terrain reflection is discrete but robust

License
-------
MIT. If a `LICENSE` file is added, it supersedes this note.


