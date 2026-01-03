/**
 * Arena Builder - Interactive GUI for creating custom arenas
 * Saves custom arenas as JSON that can be imported into main.js
 */

const SCALE = 2; // pixels per unit
const UNITS_PER_METER = 10; // conversion factor
const ARENA_RADIUS_UNITS = 160;
const POINT_RADIUS = 8;
const SNAP_DISTANCE = 25; // pixels to snap to start point

class ArenaBuilder {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.points = []; // user-drawn points only
        this.distances = []; // distances between consecutive points
        this.locked = false;
        this.drawing = false;
        this.paused = false;
        this.mirror = false;
        this.pendingDistanceUnits = null;
        this.pendingClickDirection = null; // stores direction from initial click
        this.currentDistToYAxis = 0;
        this.startPoint = null;

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.setupEventListeners();
        this.draw();
    }

    resizeCanvas() {
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.draw();
    }

    setupEventListeners() {
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('auxclick', (e) => this.handleMiddleClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this.handleRightClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));

        document.getElementById('resetBtn').addEventListener('click', () => this.reset());
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('lockBtn').addEventListener('click', () => this.lock());
        document.getElementById('saveBtn').addEventListener('click', () => this.showExport());
        document.getElementById('copyBtn').addEventListener('click', () => this.copyToClipboard());
        document.getElementById('mirrorToggle').addEventListener('change', (e) => {
            this.mirror = e.target.checked;
            this.draw();
        });
    }

    handleCanvasClick(e) {
        if (this.locked) return;

        const rect = this.canvas.getBoundingClientRect();
        let x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // If mirror is enabled, snap to Y-axis if click is close to center
        const cx = this.canvas.width / 2;
        const distToCenter = Math.abs(x - cx);
        if (this.mirror && distToCenter < 20) { // 20 pixel snap distance
            x = cx;
        }

        // Check if clicking near the start point (to close the polygon)
        if (this.points.length >= 3 && this.startPoint) {
            const distToStart = Math.hypot(x - this.startPoint.x, y - this.startPoint.y);
            if (distToStart <= SNAP_DISTANCE) {
                this.promptDistance(true); // final segment
                return;
            }
        }

        // If first point
        if (this.points.length === 0) {
            this.startPoint = { x, y };
            this.points.push({ x, y });
            this.drawing = true;
            this.updateUI();
            this.draw();
            return;
        }

        // Save the click direction before prompting
        const lastPoint = this.points[this.points.length - 1];
        const dx = x - lastPoint.x;
        const dy = y - lastPoint.y;
        const dist = Math.hypot(dx, dy);
        
        if (dist > 0) {
            // Normalize direction and save it
            this.pendingClickDirection = {
                nx: dx / dist,
                ny: dy / dist
            };
        }

        // Prompt for distance from previous point to this new point
        this.promptDistance(false, () => {
            if (this.pendingClickDirection && this.pendingDistanceUnits !== null) {
                // Place point using saved direction and confirmed distance
                const newX = lastPoint.x + this.pendingClickDirection.nx * (this.pendingDistanceUnits * SCALE);
                const newY = lastPoint.y + this.pendingClickDirection.ny * (this.pendingDistanceUnits * SCALE);
                
                this.points.push({ x: newX, y: newY });
                
                this.pendingClickDirection = null;
                this.pendingDistanceUnits = null;
                this.updateUI();
                this.draw();
            }
        });
    }

    promptDistance(isClosing, callback) {
        const lastPoint = this.points[this.points.length - 1];

        let promptText = isClosing
            ? `Distance from last point back to start (meters):`
            : `Distance from last point to new point (meters):`;

        const distance = prompt(promptText, '50');
        
        if (distance === null) {
            // Cancelled - clear pending direction
            this.pendingClickDirection = null;
            return;
        }

        const dist = parseFloat(distance);
        if (isNaN(dist) || dist <= 0) {
            alert('Please enter a valid positive distance');
            this.pendingClickDirection = null;
            return;
        }

        this.distances.push(dist * UNITS_PER_METER);

        if (isClosing) {
            // Complete the polygon
            this.locked = true;
            this.drawing = false;
            this.pendingClickDirection = null;
        } else {
            // Store the distance for the callback to use with saved direction
            this.pendingDistanceUnits = dist * UNITS_PER_METER;
            if (callback) {
                callback();
            }
        }

        this.updateUI();
        this.draw();
    }

    handleMouseMove(e) {
        if (this.locked || !this.drawing || this.paused) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const lastPoint = this.points[this.points.length - 1];
        
        // Calculate distance to Y axis
        const cx = this.canvas.width / 2;
        const distToYAxis = Math.abs(x - cx) / SCALE / UNITS_PER_METER;
        this.currentDistToYAxis = distToYAxis;
        
        this.draw();
        
        // Draw preview line to cursor if no pending distance
        if (this.pendingDistanceUnits === null) {
            this.ctx.strokeStyle = 'rgba(74, 158, 255, 0.5)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(lastPoint.x, lastPoint.y);
            this.ctx.lineTo(x, y);
            this.ctx.stroke();

            // Draw distance preview
            const dist = Math.hypot(x - lastPoint.x, y - lastPoint.y) / SCALE;
            this.ctx.fillStyle = 'rgba(74, 158, 255, 0.8)';
            this.ctx.font = '12px monospace';
            const text = (dist / UNITS_PER_METER).toFixed(1) + 'm';
            const mid = {
                x: (lastPoint.x + x) / 2,
                y: (lastPoint.y + y) / 2
            };
            this.ctx.fillText(text, mid.x + 5, mid.y - 5);
            
            // Draw mirrored preview if mirror is enabled
            if (this.mirror) {
                const mirroredLastX = cx - (lastPoint.x - cx);
                const mirroredX = cx - (x - cx);
                this.ctx.strokeStyle = 'rgba(200, 116, 60, 0.6)';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(mirroredLastX, lastPoint.y);
                this.ctx.lineTo(mirroredX, y);
                this.ctx.stroke();
            }
        } else if (this.pendingClickDirection) {
            // Draw constrained preview showing the exact distance that will be placed
            const previewX = lastPoint.x + this.pendingClickDirection.nx * (this.pendingDistanceUnits * SCALE);
            const previewY = lastPoint.y + this.pendingClickDirection.ny * (this.pendingDistanceUnits * SCALE);
            
            this.ctx.strokeStyle = 'rgba(46, 204, 113, 0.7)';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(lastPoint.x, lastPoint.y);
            this.ctx.lineTo(previewX, previewY);
            this.ctx.stroke();
            
            // Draw the distance label
            this.ctx.fillStyle = 'rgba(46, 204, 113, 0.9)';
            this.ctx.font = '12px monospace';
            const text = (this.pendingDistanceUnits / UNITS_PER_METER).toFixed(1) + 'm (SET)';
            const mid = {
                x: (lastPoint.x + previewX) / 2,
                y: (lastPoint.y + previewY) / 2
            };
            this.ctx.fillText(text, mid.x + 5, mid.y - 5);
            
            // Draw mirrored preview if mirror is enabled
            if (this.mirror) {
                const mirroredLastX = cx - (lastPoint.x - cx);
                const mirroredPreviewX = cx - (previewX - cx);
                this.ctx.strokeStyle = 'rgba(200, 116, 60, 0.7)';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(mirroredLastX, lastPoint.y);
                this.ctx.lineTo(mirroredPreviewX, previewY);
                this.ctx.stroke();
            }
        }

        // Highlight if near start point
        if (this.points.length >= 3 && this.startPoint) {
            const distToStart = Math.hypot(x - this.startPoint.x, y - this.startPoint.y);
            if (distToStart <= SNAP_DISTANCE) {
                this.ctx.strokeStyle = '#2ecc71';
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                this.ctx.arc(this.startPoint.x, this.startPoint.y, SNAP_DISTANCE, 0, Math.PI * 2);
                this.ctx.stroke();
            }
        }
        
        // Draw Y-axis distance tracker
        this.drawDistanceTracker(x, distToYAxis);
    }

    handleMiddleClick(e) {
        e.preventDefault();
        if (this.drawing && this.points.length >= 3) {
            this.promptDistance(true);
        }
    }

    handleRightClick(e) {
        e.preventDefault();
        if (this.drawing) {
            this.paused = !this.paused;
            this.draw();
        }
    }

    reset() {
        this.points = [];
        this.distances = [];
        this.locked = false;
        this.drawing = false;
        this.paused = false;
        this.pendingDistanceUnits = null;
        this.pendingClickDirection = null;
        this.startPoint = null;
        document.getElementById('arenaName').value = '';
        document.getElementById('jsonOutput').textContent = '';
        this.updateUI();
        this.draw();
    }

    undo() {
        if (this.locked || this.points.length <= 1) return;
        
        // If mirror is enabled, we added 2 points at once, so remove 2
        const pointsToRemove = this.mirror && this.points.length > 1 ? 2 : 1;
        
        // Remove the points
        for (let i = 0; i < pointsToRemove && this.points.length > 1; i++) {
            this.points.pop();
        }
        
        // Remove the corresponding distance (the distance leading TO the removed point)
        if (this.distances.length > 0) {
            this.distances.pop();
        }
        
        this.updateUI();
        this.draw();
    }

    lock() {
        if (this.points.length >= 3 && !this.locked) {
            this.promptDistance(true);
        }
    }

    updateUI() {
        const pointCount = this.points.length;
        document.getElementById('pointCount').textContent = pointCount;

        // Update perimeter
        const perimeter = this.distances.reduce((a, b) => a + b, 0);
        document.getElementById('perimeterValue').textContent = (perimeter / UNITS_PER_METER).toFixed(2) + 'm';

        // Update instruction and status
        const instruction = document.getElementById('instruction');
        const status = document.getElementById('status');

        if (this.locked) {
            instruction.textContent = '✓ Arena locked! Export using the JSON export below.';
            instruction.classList.add('locked');
            instruction.classList.remove('active');
            status.textContent = 'Locked';
            status.classList.add('status-locked');
            status.classList.remove('status-drawing', 'status-ready');
            document.getElementById('lockBtn').disabled = true;
            document.getElementById('undoBtn').disabled = true;
            document.getElementById('saveBtn').disabled = false;
        } else if (this.drawing) {
            instruction.textContent = `${pointCount} point(s) placed. Click to add more or middle-click to complete.`;
            instruction.classList.add('active');
            instruction.classList.remove('locked');
            status.textContent = 'Drawing';
            status.classList.add('status-drawing');
            status.classList.remove('status-locked', 'status-ready');
            document.getElementById('lockBtn').disabled = pointCount < 3;
            document.getElementById('undoBtn').disabled = pointCount <= 1;
        } else {
            instruction.textContent = 'Click canvas to start drawing the arena boundary';
            instruction.classList.add('active');
            instruction.classList.remove('locked');
            status.textContent = 'Ready';
            status.classList.add('status-ready');
            status.classList.remove('status-drawing', 'status-locked');
            document.getElementById('lockBtn').disabled = true;
            document.getElementById('undoBtn').disabled = true;
            document.getElementById('saveBtn').disabled = true;
        }

        // Update point list
        this.updatePointList();
    }

    updatePointList() {
        const pointList = document.getElementById('pointList');
        
        if (this.points.length === 0) {
            pointList.innerHTML = '<div style="color: #666; font-size: 12px; text-align: center; padding: 20px;">No points yet</div>';
            return;
        }

        let html = '';
        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            const dist = this.distances[i] || (i === this.points.length - 1 && this.locked ? this.distances[i] : null);
            
            html += `<div class="point-item">
                <span>P${i + 1}: <span class="point-coords">(${(p.x / SCALE / UNITS_PER_METER).toFixed(1)}, ${(p.y / SCALE / UNITS_PER_METER).toFixed(1)})m</span></span>
                ${dist ? `<span class="point-distance">${(dist / UNITS_PER_METER).toFixed(1)}m</span>` : ''}
            </div>`;
        }
        pointList.innerHTML = html;
    }

    draw() {
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        this.ctx.fillStyle = '#1a1a1a';
        this.ctx.fillRect(0, 0, w, h);

        // Draw grid
        this.drawGrid();
        
        // Draw mirror line if enabled
        if (this.mirror) {
            this.ctx.strokeStyle = 'rgba(200, 116, 60, 0.3)';
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([5, 5]);
            const cx = w / 2;
            this.ctx.beginPath();
            this.ctx.moveTo(cx, 0);
            this.ctx.lineTo(cx, h);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
        }

        // Draw points
        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            const isStart = i === 0;
            const isLast = i === this.points.length - 1;

            // Draw point circle
            this.ctx.fillStyle = isStart ? '#2ecc71' : isLast ? '#ff9a4a' : '#4a9eff';
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2);
            this.ctx.fill();

            // Draw label
            this.ctx.fillStyle = '#e0e0e0';
            this.ctx.font = 'bold 11px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(`P${i + 1}`, p.x, p.y);
            
            // Draw mirrored point if mirror is enabled
            if (this.mirror) {
                const cx = w / 2;
                const mirroredX = cx - (p.x - cx);
                this.ctx.fillStyle = isStart ? '#2ecc71' : isLast ? '#ff9a4a' : '#4a9eff';
                this.ctx.globalAlpha = 0.6;
                this.ctx.beginPath();
                this.ctx.arc(mirroredX, p.y, POINT_RADIUS, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.globalAlpha = 1;
            }
        }

        // Draw lines connecting points
        if (this.points.length > 1) {
            const cx = w / 2;
            
            // Draw main lines
            this.ctx.strokeStyle = '#556';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(this.points[0].x, this.points[0].y);
            for (let i = 1; i < this.points.length; i++) {
                this.ctx.lineTo(this.points[i].x, this.points[i].y);
            }
            if (this.locked) {
                this.ctx.lineTo(this.points[0].x, this.points[0].y); // close polygon
            }
            this.ctx.stroke();
            
            // Draw mirrored lines if mirror is enabled
            if (this.mirror) {
                this.ctx.strokeStyle = 'rgba(200, 116, 60, 0.8)';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                
                // Start from mirrored first point
                let mirroredX = cx - (this.points[0].x - cx);
                this.ctx.moveTo(mirroredX, this.points[0].y);
                
                // Draw through all points, mirrored
                for (let i = 1; i < this.points.length; i++) {
                    mirroredX = cx - (this.points[i].x - cx);
                    this.ctx.lineTo(mirroredX, this.points[i].y);
                }
                
                if (this.locked) {
                    mirroredX = cx - (this.points[0].x - cx);
                    this.ctx.lineTo(mirroredX, this.points[0].y); // close polygon
                }
                this.ctx.stroke();
            }
        }

        // Draw distance labels
        if (this.points.length > 1) {
            const cx = w / 2;
            this.ctx.fillStyle = '#2ecc71';
            this.ctx.font = '11px monospace';
            this.ctx.textAlign = 'center';

            for (let i = 0; i < this.distances.length; i++) {
                const p1 = this.points[i];
                const p2 = this.points[i + 1] || this.points[0];
                const mid = {
                    x: (p1.x + p2.x) / 2,
                    y: (p1.y + p2.y) / 2
                };
                const text = (this.distances[i] / UNITS_PER_METER).toFixed(1) + 'm';
                
                // Draw background for text
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                const metrics = this.ctx.measureText(text);
                this.ctx.fillRect(mid.x - metrics.width / 2 - 3, mid.y - 10, metrics.width + 6, 14);
                
                this.ctx.fillStyle = '#2ecc71';
                this.ctx.fillText(text, mid.x, mid.y);
                
                // Draw mirrored distance labels if mirror is enabled
                if (this.mirror) {
                    const mirroredP1X = cx - (p1.x - cx);
                    const mirroredP2X = cx - (p2.x - cx);
                    const mirroredMid = {
                        x: (mirroredP1X + mirroredP2X) / 2,
                        y: (p1.y + p2.y) / 2
                    };
                    
                    // Draw background for mirrored text
                    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
                    this.ctx.fillRect(mirroredMid.x - metrics.width / 2 - 3, mirroredMid.y - 10, metrics.width + 6, 14);
                    
                    this.ctx.fillStyle = 'rgba(200, 116, 60, 0.8)';
                    this.ctx.fillText(text, mirroredMid.x, mirroredMid.y);
                }
            }
        }

        // Draw center point marker
        const cx = w / 2;
        const cy = h / 2;
        this.ctx.strokeStyle = '#445';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        this.ctx.stroke();
    }

    drawGrid() {
        const gridSpacing = SCALE * 50; // every 50 units
        this.ctx.strokeStyle = '#333';
        this.ctx.lineWidth = 0.5;

        for (let x = 0; x < this.canvas.width; x += gridSpacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvas.height);
            this.ctx.stroke();
        }

        for (let y = 0; y < this.canvas.height; y += gridSpacing) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvas.width, y);
            this.ctx.stroke();
        }
    }

    drawDistanceTracker(mouseX, distToYAxis) {
        const cx = this.canvas.width / 2;
        
        // Draw vertical line from Y-axis to cursor
        this.ctx.strokeStyle = 'rgba(200, 116, 60, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([3, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(cx, 0);
        this.ctx.lineTo(cx, this.canvas.height);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        
        // Draw horizontal line from Y-axis to cursor
        const lastPoint = this.points[this.points.length - 1];
        this.ctx.strokeStyle = 'rgba(200, 116, 60, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([3, 3]);
        this.ctx.beginPath();
        this.ctx.moveTo(cx, lastPoint.y);
        this.ctx.lineTo(mouseX, lastPoint.y);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
        
        // Draw distance label
        this.ctx.fillStyle = 'rgba(200, 116, 60, 0.8)';
        this.ctx.font = 'bold 14px monospace';
        this.ctx.textAlign = 'center';
        const text = distToYAxis.toFixed(2) + 'm';
        const midX = (cx + mouseX) / 2;
        const midY = lastPoint.y - 15;
        
        // Background for text
        const metrics = this.ctx.measureText(text);
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        this.ctx.fillRect(midX - metrics.width / 2 - 5, midY - 10, metrics.width + 10, 16);
        
        // Text
        this.ctx.fillStyle = 'rgba(200, 116, 60, 1)';
        this.ctx.fillText(text, midX, midY);
    }

    showExport() {
        if (!this.locked) {
            alert('Lock the arena first!');
            return;
        }

        const arenaName = document.getElementById('arenaName').value.trim();
        if (!arenaName) {
            alert('Please enter an arena name');
            return;
        }

        // Convert pixels to world units
        let arenaPoints = this.points.map(p => ({
            x: (p.x - this.canvas.width / 2) / SCALE,
            y: (p.y - this.canvas.height / 2) / SCALE
        }));
        
        // If mirror is enabled, add mirrored points to the export
        if (this.mirror) {
            const mirroredPoints = this.points.map(p => ({
                x: -((p.x - this.canvas.width / 2) / SCALE),
                y: (p.y - this.canvas.height / 2) / SCALE
            }));
            // Reverse the mirrored points and append them to create a complete symmetrical polygon
            arenaPoints = arenaPoints.concat(mirroredPoints.reverse());
        }

        const arenaData = {
            name: arenaName,
            type: 'polygon',
            points: arenaPoints,
            distances: this.distances
        };

        const json = JSON.stringify(arenaData, null, 2);
        document.getElementById('jsonOutput').textContent = json;
        document.getElementById('copyBtn').disabled = false;
    }

    copyToClipboard() {
        const json = document.getElementById('jsonOutput').textContent;
        if (!json) {
            alert('Export arena first');
            return;
        }

        navigator.clipboard.writeText(json).then(() => {
            const btn = document.getElementById('copyBtn');
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
                btn.textContent = original;
            }, 2000);
        });
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new ArenaBuilder('arenaCanvas');
});
