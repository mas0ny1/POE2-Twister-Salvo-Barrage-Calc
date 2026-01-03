# Arena Builder Guide

## Overview
The Arena Builder is an interactive GUI tool for creating custom arena polygons that can be imported into the Twister Simulator. Instead of manually editing code, you can visually design arena shapes and export them as JSON.

## How to Use

### 1. Open the Arena Builder
Click the **Arena Builder** button on the main simulator page (under Simulation section), or open `arena-builder.html` directly in your browser.

### 2. Drawing Your Arena

#### Starting
- **First Click**: Click anywhere on the canvas to place your first point (shown in green)
- The instruction panel will update to show your progress

#### Adding Points
- **Subsequent Clicks**: Each click prompts you to enter the **distance in world units** from the previous point
  - Enter a positive number (e.g., `50`, `75.5`)
  - The line will be drawn with this distance labeled
- **Visual Feedback**: As you move the mouse, a preview line shows where the next segment will go

#### Closing the Shape
- **Near Start Point**: When you get close to the starting point (within the green circle), you can:
  - Click to automatically prompt for the closing distance, OR
  - Middle-click (wheel-click) to lock in all points
- **Minimum Points**: You need at least 3 points to form a valid polygon

### 3. Locking the Arena
Once you've placed all points and the shape is complete:
- Click the **Lock Points (Middle-Click)** button, OR
- Middle-click near the starting point when drawing
- The arena will turn orange and become locked for export

### 4. Exporting as JSON

#### Setting Arena Name
- Enter a unique name in the "Arena name" field (e.g., `custom_arena_1`, `boss_chamber`)
- Click **Save as JSON**
- The JSON will appear in the "Export" panel

#### Example JSON Output
```json
{
  "name": "custom_arena_1",
  "type": "polygon",
  "points": [
    {"x": -80, "y": -60},
    {"x": 80, "y": -60},
    {"x": 100, "y": 40},
    {"x": 0, "y": 80},
    {"x": -100, "y": 40}
  ],
  "distances": [50, 55.9, 65.2, 71.4, 63.6]
}
```

#### Copying to Clipboard
- Click **Copy JSON to Clipboard** to copy the entire JSON
- You can then paste it into your code or a JSON file

### 5. Integrating with main.js

#### Quick Steps
1. Copy the exported JSON from the Arena Builder
2. In `main.js`, find the `createArena(type)` function around line 974
3. Add your custom arena type with a PolygonArena class

#### Example Integration

Add this class to `main.js` (after other Arena classes):
```javascript
class PolygonArena extends Arena {
  constructor(width, height, scale, points) {
    super(width, height);
    this.cx = width / 2;
    this.cy = height / 2;
    this.scale = scale;
    this.points = points.map(p => ({
      x: this.cx + p.x * ARENA_RADIUS_UNITS * scale,
      y: this.cy + p.y * ARENA_RADIUS_UNITS * scale
    }));
    
    // Build line segments for collision detection
    this.segments = [];
    for (let i = 0; i < this.points.length; i++) {
      const p1 = this.points[i];
      const p2 = this.points[(i + 1) % this.points.length];
      this.segments.push({x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y});
    }
  }
  
  collideCircle(x, y, r) {
    for (const s of this.segments) {
      const vx = s.x2 - s.x1, vy = s.y2 - s.y1;
      const wx = x - s.x1, wy = y - s.y1;
      const vLen2 = vx * vx + vy * vy;
      const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / vLen2));
      const closestX = s.x1 + t * vx, closestY = s.y1 + t * vy;
      const dx = x - closestX, dy = y - closestY;
      const dist = Math.hypot(dx, dy);
      
      if (dist < r) {
        const nx = dx / dist, ny = dy / dist;
        const px = closestX + nx * r, py = closestY + ny * r;
        return {hit: true, nx, ny, reflect: true, x: px, y: py};
      }
    }
    return {hit: false};
  }
  
  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = '#334';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
```

#### Update createArena() method
Modify the `createArena(type)` method to include your custom arena:
```javascript
createArena(type) {
  if (type === 'square') return new SquareArena(this.width, this.height, this.scale);
  if (type === 'tjunction') return new TJunctionArena(this.width, this.height, this.scale);
  if (type === 'custom_arena_1') {
    return new PolygonArena(this.width, this.height, this.scale, [
      {"x": -80, "y": -60},
      {"x": 80, "y": -60},
      {"x": 100, "y": 40},
      {"x": 0, "y": 80},
      {"x": -100, "y": 40}
    ]);
  }
  return new CircleArena(this.width, this.height, this.scale);
}
```

#### Update the Arena Selection Dropdown
Add your arena to the `<select>` in `index.html`:
```html
<select id="arenaType">
  <option value="circle">Circle Arena</option>
  <option value="square">Square Arena</option>
  <option value="tjunction">T-Junction</option>
  <option value="custom_arena_1">Custom Arena 1</option>
</select>
```

## Tips & Tricks

### Coordinate System
- **Origin (0,0)** is at the center of the canvas
- **X-axis** increases to the right
- **Y-axis** increases downward
- The grid shows 50-unit intervals

### Distance Input
- Use decimal values for precision: `45.5`, `62.3`, etc.
- Distances don't need to match the visual exactly—you specify them manually
- Total perimeter is shown in the Info panel

### Visual Aids
- **Green point**: Starting point of your arena
- **Orange point**: Last point placed
- **Blue points**: All other points
- **Green circle**: Snap zone near the start point (for closing)
- **Grid lines**: Every 50 world units

### Resetting
- Click **Reset** to clear all points and start over
- The arena name field will also be cleared

## Troubleshooting

**Q: I can't close my arena**
- You need at least 3 points
- Make sure you're clicking within the green circle near the start point, or use middle-click

**Q: The distance prompt asks for input repeatedly**
- Clicking multiple times triggers multiple prompts—wait for the dialog to close before clicking again

**Q: My arena doesn't show up in the dropdown**
- Make sure you added it to both the `createArena()` function AND the `<select>` dropdown in index.html
- Refresh your browser to load the updated main.js

**Q: The JSON looks wrong**
- Check that your arena name has no spaces (use underscores instead)
- The points are in world units (not pixels), which is correct for export

## File Structure

- `arena-builder.html` - The interactive builder UI
- `arena-builder.js` - The drawing and export logic
- `main.js` - Where you integrate your custom arenas
- `index.html` - Main simulator page with arena selection

---

Happy arena building! 🎯
