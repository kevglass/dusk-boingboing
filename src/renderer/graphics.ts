import { resumeAudioOnInput } from "./sound";

// This is a very brute force simple renderer. It's just blitting images and text to 
// a canvas. It's wrapped with a view to replacing it with something decent

const canvas = document.getElementById("gamecanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
let eventListener: InputEventListener | undefined;
let mouseDown = false;

ctx.imageSmoothingEnabled = false;
canvas.style.imageRendering = "pixelated";

let resourcesRequested = 0;
let resourcesLoaded = 0;

const scaledImageCache: Record<string, Record<number, CanvasImageSource>> = {};
const pixelScale = window.devicePixelRatio; 
console.log("Pixel scale: " + pixelScale);

export function getResourceLoadingProgress(): number {
    return resourcesLoaded / resourcesRequested;
}

export function getResourceLoadingStatus(): string {
    return resourcesLoaded + "/" + resourcesRequested;
}

export function resourceRequested(url: string): void {
    resourcesRequested++;
    console.log("Loading: ", url);
}

export function resourceLoaded(url: string): void {
    resourcesLoaded++;
    console.log("Loaded: ", url);
    if (resourcesLoaded >= resourcesRequested) {
        eventListener?.resourcesLoaded();
    }
}
// a tile set cuts an imag into pieces to be used as sprites
export interface TileSet {
    image: HTMLImageElement;
    tileWidth: number;
    tileHeight: number;
}

// a hook back for mouse/touch events
export interface InputEventListener {
    mouseDown(x: number, y: number, index: number): void;
    mouseDrag(x: number, y: number, index: number): void;
    mouseUp(x: number, y: number, index: number): void;
    keyDown(key: string): void;
    keyUp(key: string): void;
    resourcesLoaded(): void;
}

// register an event listener for mouse/touch events
export function registerInputEventListener(listener: InputEventListener): void {
    eventListener = listener;
}

document.addEventListener('contextmenu', event => {
    event.preventDefault();
});

canvas.addEventListener('contextmenu', event => {
    event.preventDefault();
});

canvas.addEventListener("touchstart", (event) => {
    resumeAudioOnInput();
    canvas.focus();

    for (const touch of event.changedTouches) {
        eventListener?.mouseDown(touch.clientX * pixelScale, touch.clientY * pixelScale, touch.identifier);
    }

    event.stopPropagation();
    event.preventDefault();
});

canvas.setAttribute("tabindex", "0");

canvas.addEventListener("keydown", (event) => {
    eventListener?.keyDown(event.key);
});

canvas.addEventListener("keyup", (event) => {
    eventListener?.keyUp(event.key);
});

canvas.addEventListener("touchend", (event) => {
    resumeAudioOnInput();

    for (const touch of event.changedTouches) {
        eventListener?.mouseUp(touch.clientX * pixelScale, touch.clientY * pixelScale, touch.identifier);
    }

    event.stopPropagation();
    event.preventDefault();
});

canvas.addEventListener("touchmove", (event) => {
    resumeAudioOnInput();

    for (const touch of event.changedTouches) {
        eventListener?.mouseDrag(touch.clientX * pixelScale, touch.clientY, touch.identifier);
    }

    event.stopPropagation();
    event.preventDefault();
});

canvas.addEventListener("mousedown", (event) => {
    resumeAudioOnInput();
    canvas.focus();

    eventListener?.mouseDown(event.x * pixelScale, event.y * pixelScale, event.button);
    mouseDown = true;

    event.stopPropagation();
    event.preventDefault();
});

canvas.addEventListener("mousemove", (event) => {
    resumeAudioOnInput();
    if (mouseDown) {
        eventListener?.mouseDrag(event.x * pixelScale,event.y * pixelScale, event.button);

        event.stopPropagation();
        event.preventDefault();
    }
});

canvas.addEventListener("mouseup", (event) => {
    resumeAudioOnInput();
    mouseDown = false;

    eventListener?.mouseUp(event.x / pixelScale, event.y / pixelScale, event.button);

    event.stopPropagation();
});

export function screenWidth(): number {
    return canvas.width;
}

export function screenHeight(): number {
    return canvas.height;
}

export function loadImage(url: string, track = true): HTMLImageElement {
    if (track) {
        resourceRequested(url);
    }
    const image = new Image();
    image.src = url;
    image.onerror = () => {
        console.log("Failed to load: " + url);
    }
    image.onload = () => {
        image.id = url;
        scaledImageCache[image.id] = {};
        scaledImageCache[image.id][image.width + (image.height * 10000)] = image;

        if (track) {
            resourceLoaded(url);
        }
    }

    return image;
}

// load an image and store it with tileset information
export function loadTileSet(url: string, tw: number, th: number): TileSet {
    resourceRequested(url);

    const image = new Image();
    image.src = url;
    image.onerror = () => {
        console.log("Failed to load: " + url);
    }
    image.onload = () => {
        resourceLoaded(url);
    }

    return { image, tileWidth: tw, tileHeight: th };
}

// Draw a single tile from a tile set by default at its natural size
export function drawTile(tiles: TileSet, x: number, y: number, tile: number, width: number = tiles.tileWidth, height: number = tiles.tileHeight): void {
    const tw = Math.floor(tiles.image.width / tiles.tileWidth);
    const tx = (tile % tw) * tiles.tileWidth;
    const ty = Math.floor(tile / tw) * tiles.tileHeight;

    ctx.drawImage(tiles.image, tx, ty, tiles.tileWidth, tiles.tileHeight, x, y, width, height);
}

export function outlineText(x: number, y: number, str: string, size: number, col: string, outline: string, outlineWidth: number): void {
    drawText(x - outlineWidth, y - outlineWidth, str, size, outline);
    drawText(x + outlineWidth, y - outlineWidth, str, size, outline);
    drawText(x - outlineWidth, y + outlineWidth, str, size, outline);
    drawText(x + outlineWidth, y + outlineWidth, str, size, outline);

    drawText(x, y, str, size, col);
}

// draw text at the given location 
export function drawText(x: number, y: number, str: string, size: number, col: string): void {
    ctx.fillStyle = col;
    ctx.font = "bold " + size + "px \"Fira Sans\", sans-serif";
    ctx.fillText(str, x, y);
}

// draw a rectangle outlined to the canvas
export function drawRect(x: number, y: number, width: number, height: number, col: string): void {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, width, 1);
    ctx.fillRect(x, y + height - 1, width, 1);
    ctx.fillRect(x, y, 1, height);
    ctx.fillRect(x + width - 1, y, 1, height);
}

// determine the width of a string when rendered at a given size
export function stringWidth(text: string, size: number) {
    ctx.font = "bold " + size + "px \"Fira Sans\", sans-serif";
    return ctx.measureText(text).width;
}

// draw a string onto the canvas centring it on the screen
export function centerText(text: string, size: number, y: number, col: string): void {
    const cx = Math.floor(screenWidth() / 2);
    drawText(cx - (stringWidth(text, size) / 2), y, text, size, col);
}

// give the graphics to do anything it needs to do per frame
export function updateGraphics(): void {
    canvas.width = Math.floor(window.innerWidth * pixelScale);
    canvas.height = Math.floor(window.innerHeight * pixelScale);
}

// fill a rectangle to the canvas
export function fillRect(x: number, y: number, width: number, height: number, col: string) {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, width, height);
}

// draw an image to the canvas 
export function drawImage(image: HTMLImageElement, x: number, y: number, width: number, height: number): void {
    if (image.id) {
        if (width === 0) {
            return;
        }
        let cachedScaled = scaledImageCache[image.id][width + (height * 10000)];
        if (!cachedScaled) {
            cachedScaled = scaledImageCache[image.id][width + (height * 10000)] = document.createElement("canvas");
            cachedScaled.width = width;
            cachedScaled.height = height;
            cachedScaled.getContext("2d")?.drawImage(image, 0, 0, width, height);
        }

        ctx.drawImage(cachedScaled, x, y);
    }
}

// store the current 'state' of the canvas. This includes transforms, alphas, clips etc
export function pushState() {
    ctx.save();
}

// restore the next 'state' of the canvas on the stack.
export function popState() {
    ctx.restore();
}

// set the alpha value to use when rendering 
export function setAlpha(alpha: number): void {
    ctx.globalAlpha = alpha;
}

// translate the rendering context by a given amount
export function translate(x: number, y: number): void {
    ctx.translate(x, y);
}

// scale the rendering context by a given amount
export function scale(x: number, y: number): void {
    ctx.scale(x, y);
}

export function rotate(ang: number): void {
    ctx.rotate(ang);
}

export function fillCircle(x: number, y: number, radius: number, col: string): void {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
}

export function halfCircle(x: number, y: number, radius: number, col: string): void {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, radius, Math.PI, 0);
    ctx.fill();
}