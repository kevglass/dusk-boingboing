import { Interpolator, Players } from "rune-games-sdk";
import { Controls, GameEventType, GameState, GameUpdate, gameOver, moveSpeed, platformWidth, roundTime, rowHeight } from "./logic";
import { InputEventListener, drawImage, drawText, fillCircle, fillRect, getResourceLoadingProgress, loadImage, outlineText, popState, pushState, registerInputEventListener, scale, screenHeight, screenWidth, stringWidth, translate, updateGraphics } from "./renderer/graphics";
import { Sound, loadSound, playSound } from "./renderer/sound";

const TENTH_OF_A_SECOND_IN_MS = 100;

// this is a quick way of making all the assets available
// as URLs to be loaded without having to import each one
// The import.meta.glob is a vite thing.
const ASSETS_IMPORTS = import.meta.glob("./assets/**/*", {
    query: '?url',
    import: 'default',
});
// map from the name of the assets (the path) to the
// URL it's hosted at
const ASSETS: Record<string, string> = {};

// Resolve all the imports for the assets in the src folder
async function resolveAllAssetImports() {
    const promises: Promise<unknown>[] = [];

    for (const path in ASSETS_IMPORTS) {
        const promise = ASSETS_IMPORTS[path]();
        promises.push(promise);
        promise.then((result) => {
            ASSETS[path] = result as string;
        })
    }

    await Promise.all(promises);
}

// A background in the game has three layers that are displayed
// over each other and scrolled at different rates to give the 
// parallax 
interface BackgroundSprite {
    layer1: HTMLImageElement;
    layer2: HTMLImageElement;
    layer3: HTMLImageElement;
}

// Any one of our jumper characters has 3 states and an image
// for each: 
// idle (on the way down)
// jump (on the way up)
// die (on the way out)
interface JumperSprite {
    idle: HTMLImageElement;
    jump: HTMLImageElement;
    die: HTMLImageElement;
}

// An enemy sprite in this game has a series of frames of animation - 
// for a flapping bird or bat
type EnemySprite = HTMLImageElement[];

// Main class that receives input from the user and renders the game
// along with connecting to the Rune logic layer
export class BoingBoing implements InputEventListener {
    // The assets for the jumper are all random sizes, to make them look right
    // we have the height of each asset to position the jumpers against
    // the platforms
    jumperHeights: number[] = [0.85, 0.87, 0.87, 0.9, 0.92, 0.92, 0.8, 0.87, 0.8];

    // The different themes backgrounds we have - keyed on a theme index
    backgrounds: BackgroundSprite[] = [];
    // The different themes platforms - keyed on a theme index
    platforms: HTMLImageElement[] = [];
    // The different themes platform that fall/are broken - keyed on a theme index
    platformsBroken: HTMLImageElement[] = [];
    // The different character sprites we allow the player to choose
    jumpers: JumperSprite[] = [];
    // The background box of the selected character on the character select
    box!: HTMLImageElement;
    // The background box of the non-selected characters on the character select
    boxGrey!: HTMLImageElement;
    // The big orange play button
    startButton!: HTMLImageElement;
    // The green arrow that indicates which player you are
    arrow!: HTMLImageElement;
    // The hand symbol not pressing the screen to show for instructions
    handOff!: HTMLImageElement;
    // The hand symbol pressing the screen to show for instructions
    handOn!: HTMLImageElement;
    // The spikes that appear on platforms
    spikes!: HTMLImageElement;
    // The spring that appear on platforms
    spring!: HTMLImageElement;
    // The enemy sprites keyed on the type (bat | bird)
    enemySprites: Record<string, EnemySprite> = {};
    // The arrow that points to a player above you
    arrowUp!: HTMLImageElement;
    // the arrow that points to a player below you
    arrowDown!: HTMLImageElement;

    // Sound effect played when you hit a spring
    sfxBoing!: Sound;
    // Sound effect played for UI interaction
    sfxClick!: Sound;
    // Sound effect for winning the game
    sfxFanfare!: Sound;
    // Sound effect for dieing
    sfxUrgh!: Sound;
    // Sound effect for each jump 
    sfxJump!: Sound;

    // True if all the assets have been loaded - or rather
    // asked to load and a holder created
    assetsLoaded = false;

    // The current state of the game logic received from Rune
    game?: GameState;
    // The players that are in the Rune room 
    players?: Players;
    // The ID of the player that is controlling this client
    localPlayerId?: string;
    // The character type selected - randomize it to start
    // with so we get a spread of different characters
    selectedType = Math.floor(Math.random() * 9);
    // A ticker for animation, it just counts up and 
    // some oscillating animations use it 
    anim = 0;
    // A ticker for the instructions - hand clicks on and off, 
    // and swaps left to right to show the player where to tap
    instructionTimer = 0;

    // The current state of this client's controls 
    controls: Controls = {
        left: false,
        right: false
    };

    // The last state of the controls sent to the game logic
    sentControls: Controls = {
        left: false,
        right: false
    };
    // The time in MS that the last controls were sent
    lastControlsSent = 0;

    // images loaded for player avatars - these are done dynamically
    // since they won't be packed with the game
    avatarImages: Record<string, HTMLImageElement> = {};
    // interpolators keyed on player ID used to smooth out the 
    // movement of remote players 
    interpolators: Record<string, Interpolator<number[]>> = {};
    // The time in ms that the last jump sound effect was played, since you
    // can sometimes hit platforms very close together we don't want the 
    // sound effect being spammed - it hurts your ears!
    lastJumpSfx = 0;
    // the loading message
    loadingMessage = "Compressing Springs...";

    constructor() {
        // resolve all the packed assets as imports and then load
        // them all using the rendering utilities
        resolveAllAssetImports().then(() => {
            this.loadingMessage = "Releasing birds...";

            // loading static individual images 
            this.box = loadImage(ASSETS["./assets/Ui/Box04.png"]);
            this.boxGrey = loadImage(ASSETS["./assets/Ui/Box04Grey.png"]);
            this.startButton = loadImage(ASSETS["./assets/Ui/PlayBtn.png"]);
            this.arrow = loadImage(ASSETS["./assets/Ui/arrow.png"]);
            this.handOn = loadImage(ASSETS["./assets/Hand/Click.png"]);
            this.handOff = loadImage(ASSETS["./assets/Hand/Clicked.png"]);
            this.spikes = loadImage(ASSETS["./assets/OtherAssets/obstacle.png"]);
            this.spring = loadImage(ASSETS["./assets/spring.png"]);
            this.arrowUp = loadImage(ASSETS["./assets/arrowup.png"]);
            this.arrowDown = loadImage(ASSETS["./assets/arrowdown.png"]);

            // load up the character assets
            const jumperIds = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
            for (const id of jumperIds) {
                this.jumpers[this.jumpers.length] = {
                    idle: loadImage(ASSETS["./assets/Characters/0" + id + "/Idle.png"]),
                    die: loadImage(ASSETS["./assets/Characters/0" + id + "/Die.png"]),
                    jump: loadImage(ASSETS["./assets/Characters/0" + id + "/Jump.png"]),
                }
            }

            // load up the platforms and backdrops based on the theme numbers
            const themeIds = ["1", "2", "3", "5", "6"];
            for (const id of themeIds) {
                this.backgrounds[this.backgrounds.length] = {
                    layer1: loadImage(ASSETS["./assets/Background/0" + id + "/Layer1.png"]),
                    layer2: loadImage(ASSETS["./assets/Background/0" + id + "/Layer2.png"]),
                    layer3: loadImage(ASSETS["./assets/Background/0" + id + "/Layer3.png"]),
                };

                this.platforms[this.platforms.length] = loadImage(ASSETS["./assets/OtherAssets/Platformer" + id + ".png"]);
                this.platformsBroken[this.platformsBroken.length] = loadImage(ASSETS["./assets/OtherAssets/Platformer" + id + "-broken.png"]);
            }

            // load the enemy sprites 
            this.enemySprites["bat"] = [];
            this.enemySprites["bird"] = [];
            for (let i = 1; i < 5; i++) {
                this.enemySprites["bat"].push(loadImage(ASSETS["./assets/Enemies/Bat/" + i + ".png"]));
                this.enemySprites["bird"].push(loadImage(ASSETS["./assets/Enemies/Bird/" + i + ".png"]));
            }

            // loading sound effects for Web Audio
            this.sfxBoing = loadSound(ASSETS["./assets/boing.mp3"], false);
            this.sfxClick = loadSound(ASSETS["./assets/click.mp3"], false);
            this.sfxUrgh = loadSound(ASSETS["./assets/lose.mp3"], false);
            this.sfxFanfare = loadSound(ASSETS["./assets/win.mp3"], false);
            this.sfxJump = loadSound(ASSETS["./assets/jump.mp3"], false);

        })

    }

    resourcesLoaded(): void {
        this.assetsLoaded = true;
    }

    // start the game
    start(): void {
        // register ourselves as the input listener so
        // we get nofified of mouse presses
        registerInputEventListener(this);

        // tell rune to let us know when a game
        // update happens
        Rune.initClient({
            onChange: (update) => {
                this.gameUpdate(update);
            },
        });

        // start the rendering loop
        requestAnimationFrame(() => { this.loop() });
    }

    // notification of a new game state from the Rune SDK
    gameUpdate(update: GameUpdate): void {
        this.game = update.game;
        this.players = update.players;
        this.localPlayerId = update.yourPlayerId;

        // if we've got a future game to interpolate for then 
        // update our latency based interpolators (that Rune handily
        // gives us) so that our remote players will move smoothly
        // while we wait for network updates
        if (update.futureGame && !gameOver(this.game)) {
            for (const jumper of this.game.jumpers) {
                if (!this.interpolators[jumper.id]) {
                    this.interpolators[jumper.id] = jumper.id !== this.localPlayerId ?
                        Rune.interpolatorLatency<number[]>({ maxSpeed: moveSpeed }) :
                        Rune.interpolator<number[]>();
                }

                const futureJumper = update.futureGame.jumpers.find(j => j.id === jumper.id);
                if (futureJumper) {
                    this.interpolators[jumper.id].update({
                        game: [jumper.x, jumper.y],
                        futureGame: [futureJumper.x, futureJumper.y]
                    })
                }
            }
        }

        // The logic layer runs an update loop of its own and events can 
        // take place in it. These are recorded in the game state each frame
        // so we can render or play sounds appropriately
        for (const event of this.game.events) {
            // if we jumped then play a sound - only if it's us jumping and not
            // another player or it gets very loud
            if (event.type === GameEventType.BOUNCE && event.playerId === this.localPlayerId) {
                if (Date.now() - this.lastJumpSfx > 200) {
                    this.lastJumpSfx = Date.now();
                    playSound(this.sfxJump);
                }
            }
            // The game is over, celebrate!
            if (event.type === GameEventType.WIN) {
                playSound(this.sfxFanfare);
                this.interpolators = {};
            }
            if (event.type === GameEventType.START_NEW_GAME) {
                this.interpolators = {};
            }
            // The local player died, play the death sound effect
            if (event.type === GameEventType.DIE && event.playerId === this.localPlayerId) {
                playSound(this.sfxUrgh);
            }
            // The local player hit a spring, BOOOOOIIIINNNNNGGG!
            if (event.type === GameEventType.SPRING && event.playerId === this.localPlayerId) {
                playSound(this.sfxBoing);
            }
        }
        // we have to schedule the potential change to controls
        // so that we're not effecting the game from within the 
        // game update callback
        setTimeout(() => {
            // send controls at most 10 times a second - Rune doesn't allow
            // more actions than that and only if the controls have changed
            if (this.sentControls.left !== this.controls.left ||
                this.sentControls.right !== this.controls.right) {
                if (Date.now() - this.lastControlsSent > TENTH_OF_A_SECOND_IN_MS) {
                    Rune.actions.controls({ controls: { ...this.controls } });
                    this.sentControls.left = this.controls.left;
                    this.sentControls.right = this.controls.right;
                    this.lastControlsSent = Date.now();
                }
            }
        }, 1);
    }

    // main render loop - we're active rendering on the assumption
    // that if something doesn't change every frame then it's not
    // interesting enough visually
    loop(): void {
        // schedule the next render
        requestAnimationFrame(() => { this.loop() });

        // give the utility classes a chance to update based on 
        // screen size etc
        updateGraphics();

        // wait for the assets to load the game state to initialize before
        // rendering anything
        if (!this.assetsLoaded || !this.game) {
            this.anim += 0.05;
            drawText(Math.floor((screenWidth() - stringWidth(this.loadingMessage, 20)) / 2), 100 + (Math.sin(this.anim) * 20), this.loadingMessage, 20, "white");
            fillRect(Math.floor(screenWidth() / 2) - 100, 160, 200, 20, "rgb(50,50,50)");
            fillRect(Math.floor(screenWidth() / 2) - 100, 160, Math.floor(200 * getResourceLoadingProgress()), 20, "rgb(200,200,200)");
            return;
        }

        // we'll scroll the view so our players is in the middle of the screen (that the - 0.5) - 
        // but its not quite that the simple, we actually want to scroll the view so we're looking at the highest
        // point that the player has reached, this is how they can fall of the screen
        const localPlayer = this.game.jumpers.find(j => j.id === this.localPlayerId);
        const localPlayerY = localPlayer ? this.interpolators[localPlayer.id] ? this.interpolators[localPlayer.id].getPosition()[1] : localPlayer.y : 0;
        const highest = localPlayer?.dead ? Math.max(0, localPlayerY) : Math.max(localPlayer?.highest ?? 0, localPlayerY);

        const scroll = Math.floor(Math.max(0, (highest - 0.5)) * screenHeight());

        // background rendering, we just use two copies of each layer and render them on top of 
        // each other offsetting by a factor of the player's view position. The factor changes per layer
        // so things in the background scroll slower than things in the foreground
        const theme = this.game.theme;
        const background = this.backgrounds[theme];
        const backgroundHeight = Math.floor((screenWidth() / background.layer1.width) * background.layer1.height);
        drawImage(background.layer1, 0, screenHeight() - backgroundHeight, screenWidth(), backgroundHeight);
        drawImage(background.layer1, 0, screenHeight() - (backgroundHeight * 2) + 5, screenWidth(), backgroundHeight);
        pushState();
        translate(0, Math.floor(scroll / 3) % backgroundHeight);
        for (let i = 0; i < 3; i++) {
            drawImage(background.layer2, 0, screenHeight() - backgroundHeight, screenWidth(), backgroundHeight);
            translate(0, -backgroundHeight);
        }
        popState();

        pushState();
        translate(0, Math.floor(scroll / 1.5) % backgroundHeight);
        for (let i = 0; i < 3; i++) {
            drawImage(background.layer3, 0, screenHeight() - backgroundHeight, screenWidth(), backgroundHeight);
            translate(0, -backgroundHeight);
        }
        popState();

        pushState();

        // scroll all rendering by the current view location
        translate(0, scroll);

        // calculate how big things should be - this is really important, coordinates for players
        // platforms, enemies and other stuff are all in terms of screen size, e.g. x is 0.5 if the
        // player is half way across the screen. So everything in turn gets scaled to the appropriate
        // screen size. This means everyone should see the same thing no matter the screen size.
        const platformSpriteWidth = Math.floor(screenWidth() / 6);
        const generalScale = (platformSpriteWidth / this.platforms[0].width);
        const platformHeight = generalScale * this.platforms[0].height;

        // render all the platforms if they're on screen
        const firstVisiblePlatformIndex = Math.floor((Math.max(0, highest) - 0.5) / rowHeight);
        
        for (let i=0;i<30;i++) {
            const platform = this.game.platforms[firstVisiblePlatformIndex + i];
            if (!platform) {
                continue;
            }
            if (Math.abs(platform.y - highest) > 1) {
                continue;
            }
            const platformSprite = platform.faller ? this.platformsBroken[theme] : this.platforms[theme];

            const widthScale = platform.width / platformWidth;
            drawImage(platformSprite, Math.floor(platform.x * screenWidth()), screenHeight() - Math.floor(platform.y * screenHeight()), platformSpriteWidth * widthScale, platformHeight);

        }
        // render the contents of the platform afterwards so platforms don't
        // overlay items
        for (let i=0;i<30;i++) {
            const platform = this.game.platforms[firstVisiblePlatformIndex + i];
            if (!platform) {
                continue;
            }
            if (Math.abs(platform.y - highest) > 1) {
                continue;
            }
            if (platform.spikes) {
                const widthScale = platform.width / platformWidth;
                const spikesHeight = platformHeight / 2;
                drawImage(this.spikes, Math.floor(platform.x * screenWidth()), screenHeight() - Math.floor(platform.y * screenHeight()) - (spikesHeight * 0.8), platformSpriteWidth * widthScale, spikesHeight);
            }
            if (platform.spring) {
                const widthScale = platform.width / platformWidth;
                const springHeight = platformHeight / 2;
                drawImage(this.spring, Math.floor(platform.x * screenWidth()) + (platformSpriteWidth * widthScale / 2) - (platformSpriteWidth * widthScale / 4),
                    screenHeight() - Math.floor(platform.y * screenHeight()) - (springHeight * 0.8),
                    platformSpriteWidth * widthScale / 2, springHeight);
            }
        }

        // render the enemies (birds and bar)
        for (const enemy of this.game.enemies) {
            const sprite = this.enemySprites[enemy.type];
            pushState();
            translate(enemy.x * screenWidth(), screenHeight() - enemy.y * screenHeight());
            const width = sprite[0].width * generalScale * 0.65;
            const height = sprite[0].height * generalScale * 0.65;
            if (enemy.dir === "left") {
                scale(-1, 1);
            }
            drawImage(sprite[Math.floor(this.anim * 2) % 4], -Math.floor(width / 2), -Math.floor(height / 2), width, height);
            popState();
        }

        // render the players jumping around
        for (const jumper of this.game.jumpers) {
            // pick the correct character and frame of action
            const jumperSprite = this.jumpers[jumper.type];
            const frame = jumper.dead ? jumperSprite.die : jumper.vy > 0 && this.game.jumping ? jumperSprite.jump : jumperSprite.idle;

            // scale everything by the screen and then down again by 
            // half to make them look about right on screen
            const jumperScale = generalScale * 0.5;
            const width = Math.floor(frame.width * jumperScale);
            const height = Math.floor(frame.height * jumperScale);

            // determine the logic position to render at either by using an interpolator
            // or the actual position 
            const jumperX = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[0] : jumper.x;
            const jumperY = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[1] : jumper.y;

            // if the player is off screen then we'll render 
            // an arrow later, otherwise draw the character frame
            const x = Math.floor(jumperX * screenWidth()) - Math.floor(width / 2);
            const y = screenHeight() - (Math.floor(jumperY * screenHeight()) + (height * this.jumperHeights[jumper.type]));
            if (!localPlayer?.dead && localPlayer && (jumperY < localPlayer.highest - 0.5 || jumperY > localPlayer.highest + 0.5)) {
                // offscreen so lets draw a marker
            } else {
                drawImage(frame, x, y, width, height);
            }

            // if we're at the start then we want to render a green bouncing
            // arrow helping the player to work out which player is theirs
            if (jumper.id === this.localPlayerId) {
                if (this.waitingToStart()) {
                    const arrowWidth = width * 0.7;
                    const arrowHeight = Math.floor((arrowWidth / this.arrow.width) * this.arrow.height);
                    const arrowX = Math.floor(jumper.x * screenWidth()) - Math.floor(arrowWidth / 2);
                    const arrowY = y - (height * 1.1) + Math.floor(Math.sin(this.anim) * height * 0.4)
                    drawImage(this.arrow, arrowX, arrowY, arrowWidth, arrowHeight);
                }
            }
        }

        // render any players that have already died as lines across the game field
        // showing how far they got
        if (!gameOver(this.game)) {
            for (const jumper of this.game.jumpers) {
                if (jumper.dead) {
                    const y = screenHeight() - Math.floor(jumper.highest * screenHeight());
                    fillRect(0, y, screenWidth(), 23, "rgba(0,0,0,0.5)");
                    fillRect(0, y, screenWidth(), 3, "white");
                    if (this.players) {
                        drawText(10, y + 18, this.players[jumper.id].displayName, 16, "white");
                    }
                    continue;
                }
            }
        }
        popState();

        // update our animation time, this is used to drive some basic animation
        this.anim += 0.05;

        // If the jumpers are offscreen we want to render an arrow pointing to them. We want to 
        // do this in screen space rather than in game space though so a second block here
        // outside of the push/pop state.
        if (!localPlayer?.dead) {
            for (const jumper of this.game.jumpers) {
                if (jumper.dead) {
                    continue;
                }

                const jumperX = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[0] : jumper.x;
                const jumperY = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[1] : jumper.y;

                const x = Math.floor(jumperX * screenWidth());
                if (localPlayer && (jumperY < localPlayer.highest - 0.5 || jumperY > localPlayer.highest + 0.5)) {
                    // offscreen so lets draw a marker
                    if (localPlayer.highest < jumperY) {
                        if (this.players) {
                            outlineText(x - Math.floor(stringWidth(this.players[jumper.id].displayName, 16) / 2), 70, this.players[jumper.id].displayName, 16, "white", "black", 2);
                        }
                        drawImage(this.arrowUp, x - 16, 32, this.arrowUp.width, this.arrowUp.height);
                    } else {
                        if (this.players) {
                            outlineText(x - Math.floor(stringWidth(this.players[jumper.id].displayName, 16) / 2), screenHeight() - 57, this.players[jumper.id].displayName, 16, "white", "black", 2);
                        }
                        drawImage(this.arrowDown, x - 16, screenHeight() - 50, this.arrowDown.width, this.arrowDown.height);
                    }
                }
            }
        }

        let deadOffset = 0;

        // if the game has started render the count down clock.
        if (this.game.startAt !== -1) {
            let remaining = (roundTime - (Rune.gameTime() - this.game.startAt));
            remaining = Math.min(roundTime, remaining);
            remaining = Math.max(0, remaining);
            remaining = Math.floor(remaining / 1000);

            const secs = remaining % 60;
            const mins = Math.floor(remaining / 60);
            const timeStr = mins + ":" + (secs < 10 ? "0" : "") + secs;
            fillRect(0, 0, screenWidth(), 38, "rgba(0,0,0,0.5");
            drawText(screenWidth() - 5 - stringWidth(timeStr, 30), 34, timeStr, 30, "black");
            drawText(screenWidth() - 5 - stringWidth(timeStr, 30), 30, timeStr, 30, "white");
        }

        // render any players that have already died as mini-sprites in the top left of the
        // screen. 
        for (const jumper of this.game.jumpers) {
            if (jumper.dead) {
                const jumperSprite = this.jumpers[jumper.type];
                const frame = jumperSprite.die;
                const jumperScale = generalScale * 0.5;
                const width = Math.floor(frame.width * jumperScale);
                const height = Math.floor(frame.height * jumperScale);
                drawImage(frame, deadOffset, 0, Math.floor(width / 2), Math.floor(height / 2));
                deadOffset += width / 2;
            }
        }

        // if we haven't joined yet then render the character selection screen
        // and the score board
        if (this.waitingToJoin()) {
            fillRect(0, 0, screenWidth(), screenHeight(), "rgba(0,0,0,0.5)")
            // draw the level select if we're not in game
            const boxWidth = Math.floor(screenWidth() / 4);
            const boxHeight = Math.floor((boxWidth / this.box.width) * this.box.height);

            // render our characters as a grid to be selected from
            for (let i = 0; i < 9; i++) {
                const x = i % 3;
                const y = Math.floor(i / 3);
                if (i !== this.selectedType) {
                    drawImage(this.boxGrey, Math.floor(screenWidth() * 0.125) + (x * boxWidth), 50 + (y * boxHeight), boxWidth - 5, boxHeight - 5);
                } else {
                    drawImage(this.box, Math.floor(screenWidth() * 0.125) + (x * boxWidth), 50 + (y * boxHeight), boxWidth - 5, boxHeight - 5);
                }
                const frame = this.jumpers[i].idle;
                const selectScale = generalScale * 0.5;
                drawImage(frame, Math.floor(screenWidth() * 0.12) + (x * boxWidth) + Math.floor(boxWidth / 2) - Math.floor(frame.width * selectScale * 0.5),
                    50 + Math.floor((y + 0.02) * boxHeight), frame.width * selectScale, frame.height * selectScale);
            }

            // render the big orange start button
            const startWidth = Math.floor(screenWidth() / 5);
            const startHeight = Math.floor((startWidth / this.startButton.width) * this.startButton.height);
            drawImage(this.startButton, Math.floor((screenWidth() - startWidth) / 2), screenHeight() - (startHeight * 1.2) - 110, startWidth, startHeight);

            // render the score board 
            const cols = ["rgba(0,0,0,0.7)", "rgba(10,10,10,0.7)"];
            const lines: [{ avatar: HTMLImageElement | null, name: string | null, wins: string, best: string }] = [
                { avatar: null, name: null, wins: "Wins", best: "Best" },
            ];

            if (this.players) {
                for (const id of Object.keys(this.players)) {
                    if (!this.avatarImages[id]) {
                        this.avatarImages[id] = loadImage(this.players[id].avatarUrl, false);
                    }
                    lines.push({
                        avatar: this.avatarImages[id],
                        name: this.players[id].displayName,
                        wins: "" + (this.game.scores[id] ?? 0),
                        best: "" + Math.floor((this.game.best[id] ?? 0) * 10) + "m",
                    })
                }
            }
            for (let i = 0; i < 6; i++) {
                fillRect(0, (screenHeight() - 110) + (i * 20), screenWidth(), 20, cols[i % 2]);
                const line = lines[i];
                if (line) {
                    if (line.avatar) {
                        drawImage(line.avatar, 5, (screenHeight() - 110) + (i * 20) + 2, 16, 16);
                    }
                    if (line.name) {
                        drawText(25, (screenHeight() - 110) + (i * 20) + 14, line.name, 12, "white");
                    }
                    if (line.wins) {
                        drawText(screenWidth() - 100 - Math.floor(stringWidth(line.wins, 12) / 2), (screenHeight() - 110) + (i * 20) + 14, line.wins, 12, "white");
                    }
                    if (line.best) {
                        drawText(screenWidth() - 30 - Math.floor(stringWidth(line.best, 12) / 2), (screenHeight() - 110) + (i * 20) + 14, line.best, 12, "white");
                    }
                }
            }

        } else if (!this.game.jumping) {
            // if the game is about to start then render the 3/2/1 countdown
            // int he middle of the screen based on how much time there is remaining
            const tilStart = Math.ceil((this.game.startAt - Rune.gameTime()) / 1000);
            if (tilStart <= 5 && tilStart > 0) {
                const secs = "" + tilStart;
                fillCircle(Math.floor(screenWidth() / 2), 150, 90, "rgba(0,0,0,0.5)")
                drawText(Math.floor((screenWidth() - stringWidth(secs, 80)) / 2), 180, secs, 80, "white");
            }
            this.drawInstructions();
        } else if (gameOver(this.game) && this.players) {
            // render the winning message if the game is over and we 
            // have player details
            const winner = [...this.game.jumpers].sort((a, b) => b.highest - a.highest)[0];
            const name = this.players[winner.id].displayName;
            const lines = [];
            lines.push(name);
            lines.push("Wins!");
            lines.push("Height " + Math.floor(winner.highest * 10) + "m");
            const frame = this.jumpers[winner.type].idle;
            const x = Math.floor((screenWidth() - frame.width) / 2);
            drawImage(frame, x, 50, frame.width, frame.height);
            fillRect(0, frame.height + 40, screenWidth(), 135, "rgba(0,0,0,0.5)")
            let offset = 0;
            for (const line of lines) {
                drawText(Math.floor((screenWidth() - stringWidth(line, 30)) / 2), frame.height + 80 + offset, line, 30, "white");
                offset += 35;
            }
        }
    }

    // using the animation ticker we'll make the instructions hands appear
    // in four states, left up/down and right up/down and repeat 
    // to show the player how to play
    drawInstructions(): void {
        this.instructionTimer++;
        const frame = Math.floor(this.instructionTimer / 30) % 8;
        const width = Math.floor(screenWidth() / 4);
        const height = Math.floor((width / this.handOff.width) * this.handOff.height);

        if (frame === 0 || frame === 2) {
            drawImage(this.handOff, 5, screenHeight() - height, width, height);
        }
        if (frame === 1 || frame === 3) {
            drawImage(this.handOn, 5, screenHeight() - height, width, height);
        }
        if (frame === 4 || frame === 6) {
            drawImage(this.handOff, screenWidth() - 5 - width, screenHeight() - height, width, height);
        }
        if (frame === 5 || frame === 7) {
            drawImage(this.handOn, screenWidth() - 5 - width, screenHeight() - height, width, height);
        }
    }

    waitingToJoin(): boolean {
        return !this.game?.jumpers.find(j => j.id === this.localPlayerId);
    }

    waitingToStart(): boolean {
        return this.waitingForPlayers() || !this.game?.jumping;
    }

    waitingForPlayers(): boolean {
        if (!this.players) {
            return true;
        }

        return this.game?.jumpers.length !== Object.values(this.players).length;
    }

    mouseDown(x: number, y: number): void {
        if (this.waitingToJoin()) {
            // if we're in the character select screen then
            // consider if they've clicked on a character or the start button
            const boxWidth = Math.floor(screenWidth() / 4);
            const boxHeight = Math.floor((boxWidth / this.box.width) * this.box.height);
            const startWidth = Math.floor(screenWidth() / 3);
            const startHeight = Math.floor((startWidth / this.startButton.width) * this.startButton.height);
            if (y > screenHeight() - (startHeight * 1.2) - 110) {
                // start button
                Rune.actions.join({ type: this.selectedType });
                playSound(this.sfxClick);
            } else {
                const xp = Math.floor((x - Math.floor(screenWidth() * 0.125)) / boxWidth);
                const yp = Math.floor((y - 50) / boxHeight);
                if (xp >= 0 && xp < 3 && (yp >= 0) && (yp < 3)) {
                    this.selectedType = xp + (yp * 3);
                    playSound(this.sfxClick);
                }
            }
        } else {
            // otherwise consider the press for movement
            if (!gameOver(this.game)) {
                this.considerTouch(x);
            }
        }
    }

    mouseDrag(x: number): void {
        // if we're in game consider the movement still pressing the screen
        // for movement
        if (!gameOver(this.game) && !this.waitingToJoin()) {
            this.considerTouch(x);
        }
    }

    mouseUp(): void {
        // clear the controls
        this.controls.left = false;
        this.controls.right = false;
    }

    considerTouch(x: number): void {
        // consider any touches on the left hand side of the screen
        // to be moving left and right hand side of the screen to be 
        // moving right
        if (x < screenWidth() / 2) {
            this.controls.left = true;
            this.controls.right = false;
        } else {
            this.controls.left = false;
            this.controls.right = true;
        }
    }

    keyDown(key: string): void {
        // keyboard controls are useful for
        // debugging play
        if (key === "ArrowLeft") {
            this.controls.left = true;
        }
        if (key === "ArrowRight") {
            this.controls.right = true;
        }
    }

    keyUp(key: string): void {
        // keyboard controls are useful for
        // debugging play
        if (key === "ArrowLeft") {
            this.controls.left = false;
        }
        if (key === "ArrowRight") {
            this.controls.right = false;
        }
    }
}
