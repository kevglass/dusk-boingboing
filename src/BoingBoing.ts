import { Interpolator, Players } from "rune-games-sdk";
import { Controls, GameEventType, GameState, GameUpdate, gameOver, moveSpeed, platformWidth, roundTime, rowHeight } from "./logic";
import { Game, RendererType, Sound, graphics, sound } from "togl";
import { GameFont, GameImage } from "togl";

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
    layer1: GameImage;
    layer2: GameImage;
    layer3: GameImage;
}

// Any one of our jumper characters has 3 states and an image
// for each: 
// idle (on the way down)
// jump (on the way up)
// die (on the way out)
interface JumperSprite {
    idle: GameImage;
    jump: GameImage;
    die: GameImage;
}

// An enemy sprite in this game has a series of frames of animation - 
// for a flapping bird or bat
type EnemySprite = GameImage[];

// Main class that receives input from the user and renders the game
// along with connecting to the Rune logic layer
export class BoingBoing implements Game {
    // The assets for the jumper are all random sizes, to make them look right
    // we have the height of each asset to position the jumpers against
    // the platforms
    jumperHeights: number[] = [0.85, 0.87, 0.87, 0.9, 0.92, 0.92, 0.8, 0.87, 0.8];

    // The different themes backgrounds we have - keyed on a theme index
    backgrounds: BackgroundSprite[] = [];
    // The different themes platforms - keyed on a theme index
    platforms: GameImage[] = [];
    // The different themes platform that fall/are broken - keyed on a theme index
    platformsBroken: GameImage[] = [];
    // The different character sprites we allow the player to choose
    jumpers: JumperSprite[] = [];
    // The background box of the selected character on the character select
    box!: GameImage;
    // The background box of the non-selected characters on the character select
    boxGrey!: GameImage;
    // The big orange play button
    startButton!: GameImage;
    // The green arrow that indicates which player you are
    arrow!: GameImage;
    // The hand symbol not pressing the screen to show for instructions
    handOff!: GameImage;
    // The hand symbol pressing the screen to show for instructions
    handOn!: GameImage;
    // The spikes that appear on platforms
    spikes!: GameImage;
    // The spring that appear on platforms
    spring!: GameImage;
    // The enemy sprites keyed on the type (bat | bird)
    enemySprites: Record<string, EnemySprite> = {};
    // The arrow that points to a player above you
    arrowUp!: GameImage;
    // the arrow that points to a player below you
    arrowDown!: GameImage;
    blackCircle!: GameImage;

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
    avatarImages: Record<string, GameImage> = {};
    // interpolators keyed on player ID used to smooth out the 
    // movement of remote players 
    interpolators: Record<string, Interpolator<number[]>> = {};
    // The time in ms that the last jump sound effect was played, since you
    // can sometimes hit platforms very close together we don't want the 
    // sound effect being spammed - it hurts your ears!
    lastJumpSfx = 0;
    // the loading message
    loadingMessage = "Compressing Springs...";

    // frame render every other for performance on mobile
    // devices
    renderFrame = 0;

    font16white!: GameFont;
    font12white!: GameFont;
    font30white!: GameFont;
    font30black!: GameFont;
    font16black!: GameFont;
    font80white!: GameFont;

    constructor() {
        graphics.init(RendererType.WEBGL);

        // resolve all the packed assets as imports and then load
        // them all using the rendering utilities
        resolveAllAssetImports().then(() => {
            this.loadingMessage = "Releasing birds...";

            this.font12white = graphics.generateFont(12, "white");
            this.font16white = graphics.generateFont(16, "white");
            this.font30white = graphics.generateFont(30, "white");
            this.font16black = graphics.generateFont(16, "black");
            this.font30black = graphics.generateFont(30, "black");
            this.font80white = graphics.generateFont(80, "white", "123456");

            // loading static individual images 
            this.box = graphics.loadImage(ASSETS["./assets/Ui/Box04.png"]);
            this.boxGrey = graphics.loadImage(ASSETS["./assets/Ui/Box04Grey.png"]);
            this.startButton = graphics.loadImage(ASSETS["./assets/Ui/PlayBtn.png"]);
            this.arrow = graphics.loadImage(ASSETS["./assets/Ui/arrow.png"]);
            this.handOn = graphics.loadImage(ASSETS["./assets/Hand/Click.png"]);
            this.handOff = graphics.loadImage(ASSETS["./assets/Hand/Clicked.png"]);
            this.spikes = graphics.loadImage(ASSETS["./assets/OtherAssets/obstacle.png"]);
            this.spring = graphics.loadImage(ASSETS["./assets/spring.png"]);
            this.arrowUp = graphics.loadImage(ASSETS["./assets/arrowup.png"]);
            this.arrowDown = graphics.loadImage(ASSETS["./assets/arrowdown.png"]);
            this.blackCircle = graphics.loadImage(ASSETS["./assets/blackcircle.png"]);

            // load up the character assets
            const jumperIds = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
            for (const id of jumperIds) {
                this.jumpers[this.jumpers.length] = {
                    idle: graphics.loadImage(ASSETS["./assets/Characters/0" + id + "/Idle.png"]),
                    die: graphics.loadImage(ASSETS["./assets/Characters/0" + id + "/Die.png"]),
                    jump: graphics.loadImage(ASSETS["./assets/Characters/0" + id + "/Jump.png"]),
                }
            }

            // load up the platforms and backdrops based on the theme numbers
            const themeIds = ["1", "2", "3", "5", "6"];
            for (const id of themeIds) {
                this.backgrounds[this.backgrounds.length] = {
                    layer1: graphics.loadImage(ASSETS["./assets/Background/0" + id + "/Layer1.png"]),
                    layer2: graphics.loadImage(ASSETS["./assets/Background/0" + id + "/Layer2.png"]),
                    layer3: graphics.loadImage(ASSETS["./assets/Background/0" + id + "/Layer3.png"]),
                };

                this.platforms[this.platforms.length] = graphics.loadImage(ASSETS["./assets/OtherAssets/Platformer" + id + ".png"]);
                this.platformsBroken[this.platformsBroken.length] = graphics.loadImage(ASSETS["./assets/OtherAssets/Platformer" + id + "-broken.png"]);
            }

            // load the enemy sprites 
            this.enemySprites["bat"] = [];
            this.enemySprites["bird"] = [];
            for (let i = 1; i < 5; i++) {
                this.enemySprites["bat"].push(graphics.loadImage(ASSETS["./assets/Enemies/Bat/" + i + ".png"]));
                this.enemySprites["bird"].push(graphics.loadImage(ASSETS["./assets/Enemies/Bird/" + i + ".png"]));
            }

            // loading sound effects for Web Audio
            this.sfxBoing = sound.loadSound(ASSETS["./assets/boing.mp3"], false);
            this.sfxClick = sound.loadSound(ASSETS["./assets/click.mp3"], false);
            this.sfxUrgh = sound.loadSound(ASSETS["./assets/lose.mp3"], false);
            this.sfxFanfare = sound.loadSound(ASSETS["./assets/win.mp3"], false);
            this.sfxJump = sound.loadSound(ASSETS["./assets/jump.mp3"], false);

        })

    }

    resourcesLoaded(): void {
        this.assetsLoaded = true;

        // tell rune to let us know when a game
        // update happens
        Rune.initClient({
            onChange: (update) => {
                this.gameUpdate(update);
            },
        });

    }

    // start the game
    start(): void {
        // register ourselves as the input listener so
        // we get nofified of mouse presses
        graphics.startRendering(this);
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
                    sound.playSound(this.sfxJump);
                }
            }
            // The game is over, celebrate!
            if (event.type === GameEventType.WIN) {
                sound.playSound(this.sfxFanfare);
                this.interpolators = {};
            }
            if (event.type === GameEventType.START_NEW_GAME) {
                this.interpolators = {};
            }
            // The local player died, play the death sound effect
            if (event.type === GameEventType.DIE && event.playerId === this.localPlayerId) {
                sound.playSound(this.sfxUrgh);
            }
            // The local player hit a spring, BOOOOOIIIINNNNNGGG!
            if (event.type === GameEventType.SPRING && event.playerId === this.localPlayerId) {
                sound.playSound(this.sfxBoing);
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
    render(): void {
        this.renderFrame++;

        // only render every other frame
        if (this.renderFrame % 2 === 0) {
            return;
        }

        // wait for the assets to load the game state to initialize before
        // rendering anything
        if (!this.assetsLoaded || !this.game) {
            return;
        }

        // we'll scroll the view so our players is in the middle of the screen (that the - 0.5) - 
        // but its not quite that the simple, we actually want to scroll the view so we're looking at the highest
        // point that the player has reached, this is how they can fall of the screen
        const localPlayer = this.game.jumpers.find(j => j.id === this.localPlayerId);
        const localPlayerY = localPlayer ? this.interpolators[localPlayer.id] ? this.interpolators[localPlayer.id].getPosition()[1] : localPlayer.y : 0;
        const highest = localPlayer?.dead ? Math.max(0, localPlayerY) : Math.max(localPlayer?.highest ?? 0, localPlayerY);

        const scroll = Math.floor(Math.max(0, (highest - 0.5)) * graphics.height());

        // background rendering, we just use two copies of each layer and render them on top of 
        // each other offsetting by a factor of the player's view position. The factor changes per layer
        // so things in the background scroll slower than things in the foreground
        const theme = this.game.theme;
        const background = this.backgrounds[theme];
        const backgroundHeight = Math.floor((graphics.width() / background.layer1.width) * background.layer1.height);
        graphics.drawImage(background.layer1, 0, graphics.height() - backgroundHeight, graphics.width(), backgroundHeight);
        graphics.drawImage(background.layer1, 0, graphics.height() - (backgroundHeight * 2) + 5, graphics.width(), backgroundHeight);
        graphics.push();
        graphics.translate(0, Math.floor(scroll / 3) % backgroundHeight);
        for (let i = 0; i < 3; i++) {
            graphics.drawImage(background.layer2, 0, graphics.height() - backgroundHeight, graphics.width(), backgroundHeight);
            graphics.translate(0, -backgroundHeight);
        }
        graphics.pop();

        graphics.push();
        graphics.translate(0, Math.floor(scroll / 1.5) % backgroundHeight);
        for (let i = 0; i < 3; i++) {
            graphics.drawImage(background.layer3, 0, graphics.height() - backgroundHeight, graphics.width(), backgroundHeight);
            graphics.translate(0, -backgroundHeight);
        }
        graphics.pop();

        graphics.push();

        // scroll all rendering by the current view location
        graphics.translate(0, scroll);

        // calculate how big things should be - this is really important, coordinates for players
        // platforms, enemies and other stuff are all in terms of screen size, e.g. x is 0.5 if the
        // player is half way across the screen. So everything in turn gets scaled to the appropriate
        // screen size. This means everyone should see the same thing no matter the screen size.
        const platformSpriteWidth = Math.floor(graphics.width() / 6);
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
            graphics.drawImage(platformSprite, Math.floor(platform.x * graphics.width()), graphics.height() - Math.floor(platform.y * graphics.height()), platformSpriteWidth * widthScale, platformHeight);

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
                graphics.drawImage(this.spikes, Math.floor(platform.x * graphics.width()), graphics.height() - Math.floor(platform.y * graphics.height()) - (spikesHeight * 0.8), platformSpriteWidth * widthScale, spikesHeight);
            }
            if (platform.spring) {
                const widthScale = platform.width / platformWidth;
                const springHeight = platformHeight / 2;
                graphics.drawImage(this.spring, Math.floor(platform.x * graphics.width()) + (platformSpriteWidth * widthScale / 2) - (platformSpriteWidth * widthScale / 4),
                    graphics.height() - Math.floor(platform.y * graphics.height()) - (springHeight * 0.8),
                    platformSpriteWidth * widthScale / 2, springHeight);
            }
        }

        // render the enemies (birds and bar)
        for (const enemy of this.game.enemies) {
            const sprite = this.enemySprites[enemy.type];
            graphics.push();
            graphics.translate(enemy.x * graphics.width(), graphics.height() - enemy.y * graphics.height());
            const width = sprite[0].width * generalScale;
            const height = sprite[0].height * generalScale;
            if (enemy.dir === "left") {
                graphics.scale(-1, 1);
            }
            graphics.drawImage(sprite[Math.floor(this.anim * 2) % 4], -Math.floor(width / 2), -Math.floor(height / 2), width, height);
            graphics.pop();
        }

        // render the players jumping around
        for (const jumper of this.game.jumpers) {
            // pick the correct character and frame of action
            const jumperSprite = this.jumpers[jumper.type];
            const frame = jumper.dead ? jumperSprite.die : jumper.vy > 0 && this.game.jumping ? jumperSprite.jump : jumperSprite.idle;

            // scale everything by the screen and then down again by 
            // half to make them look about right on screen
            const jumperScale = generalScale * 0.8;
            const width = Math.floor(frame.width * jumperScale);
            const height = Math.floor(frame.height * jumperScale);

            // determine the logic position to render at either by using an interpolator
            // or the actual position 
            const jumperX = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[0] : jumper.x;
            const jumperY = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[1] : jumper.y;

            // if the player is off screen then we'll render 
            // an arrow later, otherwise draw the character frame
            const x = Math.floor(jumperX * graphics.width()) - Math.floor(width / 2);
            const y = graphics.height() - (Math.floor(jumperY * graphics.height()) + (height * this.jumperHeights[jumper.type]));
            if (!localPlayer?.dead && localPlayer && (jumperY < localPlayer.highest - 0.5 || jumperY > localPlayer.highest + 0.5)) {
                // offscreen so lets draw a marker
            } else {
                graphics.drawImage(frame, x, y, width, height);
            }

            // if we're at the start then we want to render a green bouncing
            // arrow helping the player to work out which player is theirs
            if (jumper.id === this.localPlayerId) {
                if (this.waitingToStart()) {
                    const arrowWidth = width * 0.7;
                    const arrowHeight = Math.floor((arrowWidth / this.arrow.width) * this.arrow.height);
                    const arrowX = Math.floor(jumper.x * graphics.width()) - Math.floor(arrowWidth / 2);
                    const arrowY = Math.floor(y - (height * 1.1) + Math.floor(Math.sin(this.anim) * height * 0.4));
                    graphics.drawImage(this.arrow, arrowX, arrowY, arrowWidth, arrowHeight);
                }
            }
        }

        // render any players that have already died as lines across the game field
        // showing how far they got
        if (!gameOver(this.game)) {
            for (const jumper of this.game.jumpers) {
                if (jumper.dead) {
                    const y = graphics.height() - Math.floor(jumper.highest * graphics.height());
                    graphics.fillRect(0, y, graphics.width(), 23, "rgba(0,0,0,0.5)");
                    graphics.fillRect(0, y, graphics.width(), 3, "white");
                    if (this.players) {
                        graphics.drawText(10, y + 18, this.players[jumper.id].displayName, this.font16white);
                    }
                    continue;
                }
            }
        }
        graphics.pop();

        // update our animation time, this is used to drive some basic animation
        this.anim += 0.1;

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

                const x = Math.floor(jumperX * graphics.width());
                if (localPlayer && (jumperY < localPlayer.highest - 0.5 || jumperY > localPlayer.highest + 0.5)) {
                    // offscreen so lets draw a marker
                    if (localPlayer.highest < jumperY) {
                        if (this.players) {
                            graphics.outlineText(x - Math.floor(graphics.textWidth(this.players[jumper.id].displayName, this.font16black) / 2), 70, this.players[jumper.id].displayName, this.font16white, 2, this.font16black);
                        }
                        graphics.drawImage(this.arrowUp, x - 16, 32, this.arrowUp.width, this.arrowUp.height);
                    } else {
                        if (this.players) {
                            graphics.outlineText(x - Math.floor(graphics.textWidth(this.players[jumper.id].displayName, this.font16black) / 2), graphics.height() - 57, this.players[jumper.id].displayName,  this.font16white, 2, this.font16black);
                        }
                        graphics.drawImage(this.arrowDown, x - 16, graphics.height() - 50, this.arrowDown.width, this.arrowDown.height);
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
            graphics.fillRect(0, 0, graphics.width(), 38, "rgba(0,0,0,0.5)");
            graphics.drawText(graphics.width() - 5 - graphics.textWidth(timeStr, this.font30black), 34, timeStr, this.font30black);
            graphics.drawText(graphics.width() - 5 - graphics.textWidth(timeStr, this.font30white), 30, timeStr, this.font30white);
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
                graphics.drawImage(frame, deadOffset, 0, Math.floor(width / 2), Math.floor(height / 2));
                deadOffset += width / 2;
            }
        }

        // if we haven't joined yet then render the character selection screen
        // and the score board
        if (this.waitingToJoin()) {
            graphics.fillRect(0, 0, graphics.width(), graphics.height(), "rgba(0,0,0,0.5)")
            // draw the level select if we're not in game
            const boxWidth = Math.floor(graphics.width() / 4);
            const boxHeight = Math.floor((boxWidth / this.box.width) * this.box.height);

            // render our characters as a grid to be selected from
            for (let i = 0; i < 9; i++) {
                const x = i % 3;
                const y = Math.floor(i / 3);
                if (i !== this.selectedType) {
                    graphics.drawImage(this.boxGrey, Math.floor(graphics.width() * 0.125) + (x * boxWidth), 50 + (y * boxHeight), boxWidth - 5, boxHeight - 5);
                } else {
                    graphics.drawImage(this.box, Math.floor(graphics.width() * 0.125) + (x * boxWidth), 50 + (y * boxHeight), boxWidth - 5, boxHeight - 5);
                }
                const frame = this.jumpers[i].idle;
                const selectScale = generalScale * 0.8;
                graphics.drawImage(frame, Math.floor(graphics.width() * 0.12) + (x * boxWidth) + Math.floor(boxWidth / 2) - Math.floor(frame.width * selectScale * 0.5),
                    50 + Math.floor((y + 0.02) * boxHeight), frame.width * selectScale, frame.height * selectScale);
            }

            // render the big orange start button
            const startWidth = Math.floor(graphics.width() / 5);
            const startHeight = Math.floor((startWidth / this.startButton.width) * this.startButton.height);
            graphics.drawImage(this.startButton, Math.floor((graphics.width() - startWidth) / 2), graphics.height() - (startHeight * 1.2) - 110, startWidth, startHeight);

            // render the score board 
            const cols = ["rgba(0,0,0,0.7)", "rgba(10,10,10,0.7)"];
            const lines: [{ avatar: GameImage | null, name: string | null, wins: string, best: string }] = [
                { avatar: null, name: null, wins: "Wins", best: "Best" },
            ];

            if (this.players) {
                for (const id of Object.keys(this.players)) {
                    if (!this.avatarImages[id]) {
                        this.avatarImages[id] = graphics.loadImage(this.players[id].avatarUrl, false);
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
                graphics.fillRect(0, (graphics.height() - 110) + (i * 20), graphics.width(), 20, cols[i % 2]);
                const line = lines[i];
                if (line) {
                    if (line.avatar) {
                        graphics.drawImage(line.avatar, 5, (graphics.height() - 110) + (i * 20) + 2, 16, 16);
                    }
                    if (line.name) {
                        graphics.drawText(25, (graphics.height() - 110) + (i * 20) + 14, line.name, this.font12white);
                    }
                    if (line.wins) {
                        graphics.drawText(graphics.width() - 100 - Math.floor(graphics.textWidth(line.wins, this.font12white) / 2), (graphics.height() - 110) + (i * 20) + 14, line.wins, this.font12white);
                    }
                    if (line.best) {
                        graphics.drawText(graphics.width() - 30 - Math.floor(graphics.textWidth(line.best, this.font12white) / 2), (graphics.height() - 110) + (i * 20) + 14, line.best, this.font12white);
                    }
                }
            }

        } else if (!this.game.jumping) {
            // if the game is about to start then render the 3/2/1 countdown
            // int he middle of the screen based on how much time there is remaining
            const tilStart = Math.ceil((this.game.startAt - Rune.gameTime()) / 1000);
            if (tilStart <= 5 && tilStart > 0) {
                const secs = "" + tilStart;

                graphics.alpha(0.5);
                graphics.drawImage(this.blackCircle, Math.floor(graphics.width() / 2) - 90, 60);
                graphics.alpha(1);
                graphics.drawText(Math.floor((graphics.width() - graphics.textWidth(secs, this.font80white)) / 2), 180, secs, this.font80white);
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
            const x = Math.floor((graphics.width() - frame.width) / 2);
            graphics.drawImage(frame, x, 50, frame.width, frame.height);
            graphics.fillRect(0, frame.height + 40, graphics.width(), 135, "rgba(0,0,0,0.5)")
            let offset = 0;
            for (const line of lines) {
                graphics.drawText(Math.floor((graphics.width() - graphics.textWidth(line, this.font30white)) / 2), frame.height + 80 + offset, line, this.font30white);
                offset += 35;
            }
        }

        if (window.location.protocol === "http:") {
            graphics.drawText(0, 20, "FPS: " + graphics.getFPS(), this.font16white);
        }
    }

    // using the animation ticker we'll make the instructions hands appear
    // in four states, left up/down and right up/down and repeat 
    // to show the player how to play
    drawInstructions(): void {
        this.instructionTimer++;
        const frame = Math.floor(this.instructionTimer / 30) % 8;
        const width = Math.floor(graphics.width() / 4);
        const height = Math.floor((width / this.handOff.width) * this.handOff.height);

        if (frame === 0 || frame === 2) {
            graphics.drawImage(this.handOff, 5, graphics.height() - height, width, height);
        }
        if (frame === 1 || frame === 3) {
            graphics.drawImage(this.handOn, 5, graphics.height() - height, width, height);
        }
        if (frame === 4 || frame === 6) {
            graphics.drawImage(this.handOff, graphics.width() - 5 - width, graphics.height() - height, width, height);
        }
        if (frame === 5 || frame === 7) {
            graphics.drawImage(this.handOn, graphics.width() - 5 - width, graphics.height() - height, width, height);
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
            const boxWidth = Math.floor(graphics.width() / 4);
            const boxHeight = Math.floor((boxWidth / this.box.width) * this.box.height);
            const startWidth = Math.floor(graphics.width() / 3);
            const startHeight = Math.floor((startWidth / this.startButton.width) * this.startButton.height);
            if (y > graphics.height() - (startHeight * 1.2) - 110) {
                // start button
                Rune.actions.join({ type: this.selectedType });
                sound.playSound(this.sfxClick);
            } else {
                const xp = Math.floor((x - Math.floor(graphics.width() * 0.125)) / boxWidth);
                const yp = Math.floor((y - 50) / boxHeight);
                if (xp >= 0 && xp < 3 && (yp >= 0) && (yp < 3)) {
                    this.selectedType = xp + (yp * 3);
                    sound.playSound(this.sfxClick);
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
        if (x < graphics.width() / 2) {
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
