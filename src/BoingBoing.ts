import { InterpolatorLatency, Players } from "rune-games-sdk";
import { Controls, GameEventType, GameState, GameUpdate, gameOver, platformWidth, roundTime } from "./logic";
import { InputEventListener, drawImage, drawText, fillCircle, fillRect, loadImage, outlineText, popState, pushState, registerInputEventListener, scale, screenHeight, screenWidth, stringWidth, translate, updateGraphics } from "./renderer/graphics";
import { Sound, loadSound, playSound } from "./renderer/sound";

const ASSETS_IMPORTS = import.meta.glob("./assets/**/*", {
    query: '?url',
    import: 'default',
});
const ASSETS: Record<string, string> = {};

async function loadAll() {
    for (const path in ASSETS_IMPORTS) {
        ASSETS[path] = (await ASSETS_IMPORTS[path]()) as string;
    }
}

interface BackgroundSprite {
    layer1: HTMLImageElement;
    layer2: HTMLImageElement;
    layer3: HTMLImageElement;
}

interface JumperSprite {
    idle: HTMLImageElement;
    jump: HTMLImageElement;
    die: HTMLImageElement;
}

type EnemySprite = HTMLImageElement[];

export class BoingBoing implements InputEventListener {
    jumperHeights: number[] = [0.85, 0.87, 0.87, 0.9, 0.92, 0.92, 0.8, 0.87, 0.8];

    backgrounds: BackgroundSprite[] = [];
    platforms: HTMLImageElement[] = [];
    platformsBroken: HTMLImageElement[] = [];
    jumpers: JumperSprite[] = [];
    box!: HTMLImageElement;
    boxGrey!: HTMLImageElement;
    startButton!: HTMLImageElement;
    arrow!: HTMLImageElement;
    handOff!: HTMLImageElement;
    handOn!: HTMLImageElement;
    spikes!: HTMLImageElement;
    spring!: HTMLImageElement;
    enemySprites: Record<string, EnemySprite> = {};
    arrowUp!: HTMLImageElement;
    arrowDown!: HTMLImageElement;
    
    sfxBoing!: Sound;
    sfxClick!: Sound;
    sfxFanfare!: Sound;
    sfxUrgh!: Sound;
    sfxJump!: Sound;

    assetsLoaded = false;

    game?: GameState;
    players?: Players;
    localPlayerId?: string;
    selectedType = Math.floor(Math.random() * 9);
    anim = 0;
    instructionTimer = 0;

    controls: Controls = {
        left: false,
        right: false
    };

    sentControls: Controls = {
        left: false,
        right: false
    };
    lastControlsSent = 0;

    avatarImages: Record<string, HTMLImageElement> = {};
    interpolators: Record<string, InterpolatorLatency<number[]>> = {};
    lastJumpSfx = 0;

    constructor() {
        loadAll().then(() => {
            this.sfxBoing = loadSound(ASSETS["./assets/boing.mp3"]);
            this.sfxClick = loadSound(ASSETS["./assets/click.mp3"]);
            this.sfxUrgh = loadSound(ASSETS["./assets/lose.mp3"]);
            this.sfxFanfare = loadSound(ASSETS["./assets/win.mp3"]);
            this.sfxJump = loadSound(ASSETS["./assets/jump.mp3"]);

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

            const jumperIds = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
            for (const id of jumperIds) {
                this.jumpers[this.jumpers.length] = {
                    idle: loadImage(ASSETS["./assets/Characters/0" + id + "/Idle.png"]),
                    die: loadImage(ASSETS["./assets/Characters/0" + id + "/Die.png"]),
                    jump: loadImage(ASSETS["./assets/Characters/0" + id + "/Jump.png"]),
                }
            }
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

            this.enemySprites["bat"] = [];
            this.enemySprites["bird"] = [];
            for (let i=1;i<5;i++) {
                this.enemySprites["bat"].push(loadImage(ASSETS["./assets/Enemies/Bat/"+i+".png"]));
                this.enemySprites["bird"].push(loadImage(ASSETS["./assets/Enemies/Bird/"+i+".png"]));
            }
            this.assetsLoaded = true;
        })

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

        if (update.futureGame) {
            for (const jumper of this.game.jumpers) {
                if (jumper.id !== this.localPlayerId) {
                    if (!this.interpolators[jumper.id]) {
                        this.interpolators[jumper.id] = Rune.interpolatorLatency<number[]>({ maxSpeed: 0.05 });
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
        }
        for (const event of this.game.events) {
            if (event.type === GameEventType.BOUNCE && event.playerId === this.localPlayerId) {
                if (Date.now() - this.lastJumpSfx > 200) {
                    this.lastJumpSfx = Date.now();
                    playSound(this.sfxJump);
                }
            }
            if (event.type === GameEventType.WIN) {
                playSound(this.sfxFanfare);
                this.interpolators = {};
            }
            if (event.type === GameEventType.DIE && event.playerId === this.localPlayerId) {
                playSound(this.sfxUrgh);
            }
            if (event.type === GameEventType.SPRING && event.playerId === this.localPlayerId) {
                playSound(this.sfxBoing);
            }
        }
        // we have to schedule the potential change to controls
        // so that we're not effecting the game from within the 
        // game update callback
        setTimeout(() => {
            // send controls at most 10 times a second
            if (this.sentControls.left !== this.controls.left ||
                this.sentControls.right !== this.controls.right) {
                if (Date.now() - this.lastControlsSent > 100) {
                    Rune.actions.controls({ controls: { ...this.controls } });
                    this.sentControls.left = this.controls.left;
                    this.sentControls.right = this.controls.right;
                    this.lastControlsSent = Date.now();
                }
            }
        }, 1);
    }

    loop(): void {
        requestAnimationFrame(() => { this.loop() });

        updateGraphics();

        if (!this.assetsLoaded || !this.game) {
            return;
        }

        const localPlayer = this.game.jumpers.find(j => j.id === this.localPlayerId);
        const scroll = Math.floor(Math.max(0, ((localPlayer?.highest ?? 0) - 0.5)) * screenHeight());

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
        translate(0, scroll);
        const platformSpriteWidth = Math.floor(screenWidth() / 6);
        const generalScale = (platformSpriteWidth / this.platforms[0].width);
        const platformHeight = generalScale * this.platforms[0].height;

        for (const platform of this.game.platforms) {
            if (!platform) {
                continue;
            }
            const platformSprite = platform.faller ? this.platformsBroken[theme] : this.platforms[theme];

            const widthScale = platform.width / platformWidth;
            drawImage(platformSprite, Math.floor(platform.x * screenWidth()), screenHeight() - Math.floor(platform.y * screenHeight()), platformSpriteWidth * widthScale, platformHeight);
            
        }
        for (const platform of this.game.platforms) {
            if (!platform) {
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
                drawImage(this.spring, Math.floor(platform.x * screenWidth()) + (platformSpriteWidth * widthScale / 2) - (this.spring.width * widthScale / 2), 
                          screenHeight() - Math.floor(platform.y * screenHeight()) - (springHeight * 0.8), 
                            this.spring.width * widthScale, springHeight);
            }
        }

        for (const enemy of this.game.enemies) {
            const sprite = this.enemySprites[enemy.type];
            pushState();
            translate(enemy.x * screenWidth(), screenHeight() - enemy.y * screenHeight());
            const width = sprite[0].width * generalScale * 0.65;
            const height = sprite[0].height * generalScale * 0.65;
            if (enemy.dir === "left") {
                scale(-1,1);
            }
            drawImage(sprite[Math.floor(this.anim * 2) % 4], -Math.floor(width / 2), -Math.floor(height / 2), width, height);
            popState();
        }
        const myJumper = this.game.jumpers.find(j => j.id === this.localPlayerId);

        for (const jumper of this.game.jumpers) {
            const jumperSprite = this.jumpers[jumper.type];
            const frame = jumper.dead ? jumperSprite.die : jumper.vy > 0 && this.game.jumping ? jumperSprite.jump : jumperSprite.idle;
            const jumperScale = generalScale * 0.5;
            const width = Math.floor(frame.width * jumperScale);
            const height = Math.floor(frame.height * jumperScale);

            const jumperX = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[0] : jumper.x;
            const jumperY = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[1] : jumper.y;

            const x = Math.floor(jumperX * screenWidth()) - Math.floor(width / 2);
            const y = screenHeight() - (Math.floor(jumperY * screenHeight()) + (height * this.jumperHeights[jumper.type]));
            if (myJumper && (jumperY < myJumper.highest - 0.5 || jumperY > myJumper.highest + 0.5)) {
                // offscreen so lets draw a marker
            } else {
                drawImage(frame, x, y, width, height);
            }
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
        this.anim += 0.05;
        popState();
        
        for (const jumper of this.game.jumpers) {
            if (jumper.dead) {
                continue;
            }
            const jumperSprite = this.jumpers[jumper.type];
            const frame = jumper.dead ? jumperSprite.die : jumper.vy > 0 && this.game.jumping ? jumperSprite.jump : jumperSprite.idle;
            const jumperScale = generalScale * 0.5;
            const width = Math.floor(frame.width * jumperScale);
            const height = Math.floor(frame.height * jumperScale);

            const jumperX = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[0] : jumper.x;
            const jumperY = this.interpolators[jumper.id] ? this.interpolators[jumper.id].getPosition()[1] : jumper.y;

            const x = Math.floor(jumperX * screenWidth()) - Math.floor(width / 2);
            const y = screenHeight() - (Math.floor(jumperY * screenHeight()) + (height * this.jumperHeights[jumper.type]));
            if (myJumper && (jumperY < myJumper.highest - 0.5 || jumperY > myJumper.highest + 0.5)) {
                // offscreen so lets draw a marker
                if (myJumper.highest < jumperY) {
                    if (this.players) {
                        outlineText(x - Math.floor(stringWidth(this.players[myJumper.id].displayName, 16) / 2), 70, this.players[myJumper.id].displayName, 16, "white", "black", 2);
                    }
                    drawImage(this.arrowUp, x - 16, 32, this.arrowUp.width, this.arrowUp.height);
                } else {
                    if (this.players) {
                        outlineText(x - Math.floor(stringWidth(this.players[myJumper.id].displayName, 16) / 2), screenHeight() - 57, this.players[myJumper.id].displayName, 16, "white", "black", 2);
                    }
                    drawImage(this.arrowDown, x - 16, screenHeight() - 50, this.arrowDown.width, this.arrowDown.height);
                }
            }
        }

        let deadOffset = 0;

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
        if (this.waitingToJoin()) {
            fillRect(0, 0, screenWidth(), screenHeight(), "rgba(0,0,0,0.5)")
            // draw the level select if we're not in game
            const boxWidth = Math.floor(screenWidth() / 4);
            const boxHeight = Math.floor((boxWidth / this.box.width) * this.box.height);

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

            const startWidth = Math.floor(screenWidth() / 3);
            const startHeight = Math.floor((startWidth / this.startButton.width) * this.startButton.height);
            drawImage(this.startButton, Math.floor((screenWidth() - startWidth) / 2), screenHeight() - (startHeight * 1.2) - 110, startWidth, startHeight);

            const cols = ["rgba(0,0,0,0.7)", "rgba(10,10,10,0.7)"];
            const lines: [{ avatar: HTMLImageElement | null, name: string | null, wins: string, best: string }] = [
                { avatar: null, name: null, wins: "Wins", best: "Best" },
            ];

            if (this.players) {
                for (const id of Object.keys(this.players)) {
                    if (!this.avatarImages[id]) {
                        this.avatarImages[id] = loadImage(this.players[id].avatarUrl);
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
            const tilStart = Math.ceil((this.game.startAt - Rune.gameTime()) / 1000);
            if (tilStart <= 5 && tilStart > 0) {
                const secs = "" + tilStart;
                fillCircle(Math.floor(screenWidth() / 2), 150, 90, "rgba(0,0,0,0.5)")
                drawText(Math.floor((screenWidth() - stringWidth(secs, 80)) / 2), 180, secs, 80, "white");
            }
            this.drawInstructions();
        } else if (gameOver(this.game) && this.players) {
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
            if (!gameOver(this.game)) {
                this.considerTouch(x);
            }
        }
    }

    mouseDrag(x: number): void {
        if (!gameOver(this.game) && !this.waitingToJoin()) {
            this.considerTouch(x);
        }
    }

    mouseUp(): void {
        this.controls.left = false;
        this.controls.right = false;
    }

    considerTouch(x: number): void {
        if (x < screenWidth() / 2) {
            this.controls.left = true;
            this.controls.right = false;
        } else {
            this.controls.left = false;
            this.controls.right = true;
        }
    }

    keyDown(key: string): void {
        if (key === "ArrowLeft") {
            this.controls.left = true;
        }
        if (key === "ArrowRight") {
            this.controls.right = true;
        }
    }

    keyUp(key: string): void {
        if (key === "ArrowLeft") {
            this.controls.left = false;
        }
        if (key === "ArrowRight") {
            this.controls.right = false;
        }
    }

}
