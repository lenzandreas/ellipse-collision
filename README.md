# ellipse-collision
Graphically visualize the relationship between focalpoints of an ellipse

A ball starts at a focal point and bounces off the ellipse wall. Every ray leaving one focus
reflects straight into the other focus. When a ball reaches a focus, it splits into two balls
that fly off at ±θ around its incoming direction.

All focus → wall → focus paths have the same length `2a`, so every ball of a generation
arrives at a focus at the same moment. The ball count doubles in synchronized waves until it
reaches the cap. Then all balls are absorbed into a focus, which bursts in a supernova, and the
cycle restarts.

## Run

Open `index.html` in a browser; no build step is needed. To serve it locally instead:

```bash
python -m http.server 8765
```

## Controls

- **Drag from a focus** to aim and launch an extra ball (a short click launches in a random direction)
- **Space**: pause / play
- **R**: restart
- Sliders for speed, eccentricity (the ellipse morphs smoothly) and the max ball count
