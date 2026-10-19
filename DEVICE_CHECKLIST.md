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
