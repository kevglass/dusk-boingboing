import type { OnChangeAction, OnChangeEvent, PlayerId, Players, RuneClient } from "rune-games-sdk/multiplayer"

const rowHeight = 0.05;
export const platformWidth = 1 / 6;
const defaultJumpPower = 0.03;
const gravity = -0.0015;
const playerHalfWidth = 0.03;
const moveSpeed = 0.02;
export const roundTime = 1000 * 60 * 2;

export enum GameEventType {
  DIE = "die",
  WIN = "win",
  BOUNCE = "bounce",
  SPRING = "spring",
}

export interface GameEvent {
  type: GameEventType;
  playerId?: string;
}

export interface Controls {
  left: boolean;
  right: boolean;
}


export interface Jumper {
  id: string;
  x: number; // as a factor of screen width
  y: number; // as a factor of screen height
  highest: number;
  type: number;
  vy: number;
  left: boolean;
  right: boolean;
  dead: boolean;
}

export interface Enemy {
  x: number;
  y: number;
  dir: "left" | "right";
  speed: number;
  type: "bird" | "bat"
}

export interface Platform {
  x: number; // as a factor of screen width
  y: number; // as a factor of screen height
  width: number;
  spikes: boolean;
  faller: boolean;
  falling: boolean;
  vy: number;
  spring: boolean;
}

export interface GameState {
  jumpers: Jumper[],
  platforms: Platform[],
  enemies: Enemy[],
  startAt: number,
  jumping: boolean,
  gameRestartTime: number,
  theme: number,
  events: GameEvent[],
  scores: Record<string, number>;
  best: Record<string, number>;
}

// Quick type so I can pass the complex object that is the 
// Rune onChange blob around without ugliness. 
export type GameUpdate = {
  game: GameState;
  action?: OnChangeAction<GameActions>;
  event?: OnChangeEvent;
  yourPlayerId: PlayerId | undefined;
  players: Players;
  rollbacks: OnChangeAction<GameActions>[];
  previousGame: GameState;
  futureGame?: GameState;
};

type GameActions = {
  join: (params: { type: number }) => void
  controls: (params: { controls: Controls }) => void;
}

declare global {
  const Rune: RuneClient<GameState, GameActions>
}

function generatePlatform(state: GameState, i: number, requiredPlatform: boolean): Platform {
  const x = requiredPlatform
    ? 0.5 + (Math.random() * platformWidth * 2) - platformWidth
    : Math.random() * (1 - platformWidth);

  const spikes = i > 30 && !requiredPlatform && Math.random() < (0.1 + (i / 3000));
  const faller = i > 30 && !requiredPlatform && !spikes && (Math.random() < (0.1 + (i / 3000)));
  const spring = !faller && !spikes && (Math.random() < (0.08 + (i / 5000)));

  state.platforms[i] = {
    x, y: i * rowHeight, width: platformWidth, spikes, faller, falling: false, vy: 0, spring
  }

  return state.platforms[i];
}

export function gameOver(state: GameState | undefined): boolean {
  if (!state) {
    return false;
  }
  if (state.startAt === -1) {
    return false;
  }

  return !state.jumpers.find(j => !j.dead) || (Rune.gameTime() - state?.startAt > roundTime);
}

function startGame(state: GameState): void {
  state.jumpers = [];
  state.platforms = [];
  state.enemies = [];

  state.theme = Math.floor(Math.random() * 5);
  state.platforms[0] = {
    x: -platformWidth,
    y: rowHeight,
    width: 2,
    spikes: false,
    faller: false,
    falling: false,
    vy: 0,
    spring: false
  }

  // level generation follows the rules
  // 1) There must be a platform that can be used every 5 rows, otherwise
  //    people can get stuck
  // 2) Springs are random
  // 3) Spikes can be placed but don't count as a valid platform for rule 1
  // 4) Platforms get less likely as we get higher
  let lastValidRow = 0;
  for (let i = 5; i < 1000; i++) {
    if (i - lastValidRow >= 5) {
      generatePlatform(state, i, true);
      lastValidRow = i;
    } else if (Math.random() < (1 - Math.min(0.8, ((i / 50) * 0.1)))) {
      const platform = generatePlatform(state, i, false);
      if (!platform.spikes && !platform.faller) {
        lastValidRow = i;
      }
    }
  }

  let nextEnemyY = 1 + (Math.random() * 2);
  for (let i = 0; i < 10; i++) {
    state.enemies.push({
      x: (Math.random() * 0.5) + 0.25,
      y: nextEnemyY,
      type: "bird",
      speed: 0.002 + (Math.random() * 0.005),
      dir: Math.random() > 0.5 ? "left" : "right"
    });

    nextEnemyY += 1 + (Math.random() * 3);
  }

  state.startAt = -1;
  state.jumping = false;
  state.gameRestartTime = -1;
}

Rune.initLogic({
  minPlayers: 1,
  maxPlayers: 4,
  setup: (): GameState => {
    const initialState: GameState = {
      jumpers: [],
      platforms: [],
      enemies: [],
      startAt: -1,
      jumping: false,
      gameRestartTime: -1,
      theme: 0,
      events: [],
      scores: {},
      best: {}
    };

    startGame(initialState);

    return initialState;
  },
  events: {
    playerJoined: () => {
      // do nothing
    },
    playerLeft(playerId, context) {
      // do nothing
      context.game.jumpers = context.game.jumpers.filter(j => j.id !== playerId);
    }
  },
  updatesPerSecond: 30,
  update: (context) => {
    const game = context.game;
    game.events = [];

    if (game.jumping) {
      if (game.gameRestartTime === -1 && gameOver(game)) {
        game.gameRestartTime = Rune.gameTime() + 3000;
        game.events.push({ type: GameEventType.WIN });
        const winner = [...game.jumpers].sort((a, b) => b.highest - a.highest)[0];
        if (game.scores[winner.id] === undefined) {
          game.scores[winner.id] = 0;
        }
        game.scores[winner.id]++;
      }
    }
    if (game.gameRestartTime !== -1 && Rune.gameTime() > game.gameRestartTime) {
      startGame(game);
      return;
    }
    if (!game.jumping) {
      // has everyone joined?
      if (game.jumpers.length === context.allPlayerIds.length) {
        if (game.startAt === -1) {
          game.startAt = Rune.gameTime() + (1000 * 3);
        }
      }

      if (game.startAt > 0 && Rune.gameTime() > game.startAt) {
        // start the game
        game.jumping = true;

        // everyone bounces at the start
        for (const playerId of context.allPlayerIds) {
          game.events.push({ type: GameEventType.BOUNCE, playerId });
        }
      }
    } else {
      for (const platform of game.platforms) {
        if (platform && platform.falling) {
          platform.vy += gravity;
          platform.y += platform.vy;
        }
      }

      for (const enemy of game.enemies) {
        if (enemy.dir === "left") {
          enemy.x -= enemy.speed;
          if (enemy.x < 0) {
            enemy.dir = "right";
          }
        } else {
          enemy.x += enemy.speed;
          if (enemy.x > 1) {
            enemy.dir = "left";
          }
        }
      }
      for (const jumper of game.jumpers) {
        jumper.vy += gravity;
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          jumper.y += jumper.vy / steps;

          // can't land of platforms if you're dead, just fall off screen
          if (jumper.dead) {
            continue;
          }
          if (gameOver(game)) {
            continue;
          }

          // if we're falling down, then look for a platform
          // to land on
          if (jumper.vy < 0) {
            const index = Math.floor(jumper.y / rowHeight);
            const platform = game.platforms[index];
            if (platform && !platform.falling) {
              if (jumper.x > platform.x - playerHalfWidth && jumper.x < platform.x + platform.width + playerHalfWidth) {
                // landed on the platform
                if (platform.spikes) {
                  jumper.dead = true;
                  game.events.push({ type: GameEventType.DIE, playerId: jumper.id });
                }
                if (platform.faller) {
                  platform.falling = true;
                }
                jumper.y = platform.y;
                jumper.vy = platform.spring ? defaultJumpPower * 1.5 : defaultJumpPower;
                if (!platform.spikes) {
                  if (platform.spring) {
                    game.events.push({ type: GameEventType.SPRING, playerId: jumper.id });
                  } else {
                    game.events.push({ type: GameEventType.BOUNCE, playerId: jumper.id });
                  }
                }
                break;
              }
            }
          }
        }

        if (!jumper.dead) {
          if (game.enemies.find(e => Math.abs(e.x - jumper.x) < 0.05 && Math.abs(e.y - jumper.y) < 0.05)) {
            // collide with enemy
            jumper.dead = true;
            game.events.push({ type: GameEventType.DIE, playerId: jumper.id });
          }
          if (jumper.right && jumper.x < 1 - playerHalfWidth) {
            jumper.x += moveSpeed;
          }
          if (jumper.left && jumper.x > playerHalfWidth) {
            jumper.x -= moveSpeed;
          }

          jumper.highest = Math.max(jumper.highest, jumper.y);
          if (!game.best[jumper.id] || jumper.highest > game.best[jumper.id]) {
            game.best[jumper.id] = jumper.highest;
          }

          if (jumper.y < jumper.highest - 0.5 && !jumper.dead) {
            // fell off screen
            jumper.dead = true;
            game.events.push({ type: GameEventType.DIE, playerId: jumper.id });
          }
        }
      }
    }
  },
  actions: {
    join: ({ type }, context) => {
      const baseX = 0.5 - ((context.allPlayerIds.length - 1) * 0.1);
      const x = (context.allPlayerIds.indexOf(context.playerId) * 0.2) + baseX;

      context.game.jumpers.push({
        x,
        y: rowHeight,
        highest: rowHeight,
        id: context.playerId,
        type,
        vy: defaultJumpPower,
        left: false,
        right: false,
        dead: false
      });
    },
    controls: ({ controls }, context) => {
      const jumper = context.game.jumpers.find(j => j.id === context.playerId);
      if (jumper) {
        jumper.right = controls.right;
        jumper.left = controls.left;
      }
    }
  },
})
