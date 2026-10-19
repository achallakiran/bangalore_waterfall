# Device checklist: v2.1 (shell, controls, install)

Open the live github.io page on each device. Tick what works; note anything odd (device, browser, what happened).

## All devices
- [ ] Title screen shows; Play, Maps, Settings, How to play, About all open and Back works
- [ ] Hill Loop starts for both Car and Bike and looks like the version you already know (same cubes, colours, HUD)
- [ ] Pause (Esc or the pause button) stops the game; Resume continues; Exit to menu returns to the title
- [ ] Settings: voxel size, time of day, units (mph changes the speed readout), theme, Reset all work and stay after reload
- [ ] Switch tabs or apps while driving: the game pauses and no control stays stuck
- [ ] Maps, Loop Track (classic) opens and the Menu button returns
- [ ] Maps, Open a map file: a broken file shows a reason and does nothing; a copy of `hill-loop.json` with a new name opens and plays the same
- [ ] After exiting a game, start it again: it loads quickly and nothing looks different

## Mac (Chrome, Safari) and Windows (Chrome, Edge)
- [ ] F key and the full screen button enter and leave full screen
- [ ] Keyboard driving: W A S D or arrows, Space handbrake, C camera, R restart
- [ ] Double-click or drag over the HUD selects no text
- [ ] Install: Chrome/Edge Install app button works; Safari on Mac: File, Add to Dock
- [ ] Installed app opens without browser bars, and works with the network off after the first visit

## iPhone (Safari, then installed)
- [ ] Touch pad shows by itself; the four buttons are icons only
- [ ] Hold the gas button and steer with a second finger: both work together
- [ ] Long-press and drag across the HUD, the pad and the scene: no text selection, no copy or magnifier popup
- [ ] Slide a finger off a held button: it releases, nothing sticks
- [ ] Add to Home Screen, open it: full screen, no address bar, safe areas respected (notch and home bar)
- [ ] Rotate to landscape: HUD and pad stay on screen
- [ ] Play 5 minutes: no reload or crash

## Android (Chrome, then installed)
- [ ] Same touch checks as iPhone
- [ ] Install app button or browser prompt installs it; it opens full screen
- [ ] Full screen button works in the browser; landscape works
- [ ] Play 5 minutes: no reload or crash

## Memory budget (Phase 3)
- [ ] Settings > Memory budget shows Auto / Low / Medium / High and the choice is remembered.
- [ ] Hill Loop looks and plays exactly as before on every budget, including Low.
- [ ] Phone: ride for 5 minutes, leave and start again 3 times. The page stays smooth and does not reload itself.

## Map editor (3D)
- [ ] Main menu, Map editor opens a 3D view of the ground with a picture tray (below the view on a phone). The Flat button gives a top-down view.
- [ ] Desktop: drag with Look (or right-drag) turns and tilts; Shift or Space-drag slides; wheel zooms toward the pointer; Q/E turn, R/F tilt. Touch: one finger uses the tool, Look or two fingers turns, pinch zooms.
- [ ] Place a house and a shop; drag the blue dot on the ring to turn it; Face road points the front at the road; the space field changes the gap to the road.
- [ ] Row along road lines up copies on one side of the road; Copy and Ctrl+C / Ctrl+V work; one Ctrl or Cmd + Z undoes a whole row.
- [ ] Draw a straight and a curved road; drag a curve handle; Slope a road.
- [ ] Ground tab: Raise, Lower, Smooth, Level and Paint change the ground between road and building; roads do not change.
- [ ] Save file downloads a .json; Maps, Open a map file plays it with the turned buildings solid.
- [ ] Test drive (car and bike) and Drive here start on the edited map; Exit returns to the editor with the work and the camera.
- [ ] Phone: switch 3D and Flat 5 times, open and leave the editor 3 times. The page stays smooth and does not reload itself.
- [ ] Hill Loop itself still looks and drives exactly as before.

## Map editor 2: undo, growing map, slots (v2.6.0)
- [ ] iPhone: Undo, Redo and Maps buttons float at the bottom left of the map and are easy to hit. Undo says what it undoes (long-press or on a laptop, hover).
- [ ] Place a tree or a road past the east edge: the ground grows and "The map grew to ..." appears. One Undo removes the tree and the extra ground together.
- [ ] This map panel, Fit map to content trims empty ground without moving anything.
- [ ] Make a change, tap Maps: your map is listed with a picture and "open now". Close the browser tab, reopen the game, Map editor: "Continue: <name>" brings it back with its camera.
- [ ] Maps: Copy, Rename and Delete (two taps) work. New map and Copy of Hill Loop do not lose the map you left (it stays in the list).
- [ ] Main menu has "Map editor 2.5 stable". It opens the previous editor, unchanged.
- [ ] Hill Loop itself still looks and drives exactly as before.
