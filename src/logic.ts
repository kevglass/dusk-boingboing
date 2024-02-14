import type { OnChangeAction, OnChangeEvent, PlayerId, Players, RuneClient } from "rune-games-sdk/multiplayer"

// The width of a platform in screen coordinates (we get 6 platforms across the screen)
export const platformWidth = 1 / 6;
// The amount of time in ms a game runs for (currently 2 minutes)
export const roundTime = 1000 * 60 * 2;

// The height of a row of platforms in screen coordinates
const rowHeight = 0.05;
// The velocity applied to cause the jump
const defaultJumpPower = 0.03;
// The gravity thats applied every frame - not it's not related to 
// earth's gravity at all. It's just a value that "feels" right
const gravity = -0.0015;
// Half of the player's width - used for collision checks where
// the distance is from the middle of the player
const playerHalfWidth = 0.03;
// The speed the players will move horizontally
export const moveSpeed = 0.02;

// Game events that can occur in the game loop and the renderer 
// wants to respond to
export enum GameEventType {
  // A player died
  DIE = "die",
  // The game is over and somebody won
  WIN = "win",
  // A player jumped
  BOUNCE = "bounce",
  // A player hit a spring
  SPRING = "spring",
  // New game starts
  START_NEW_GAME = "game",
}

// Game events fired from the game logic loop
export interface GameEvent {
  // the event that occurred
  type: GameEventType;
  // The ID of the player involved if any
  playerId?: string;
}

// The player's controls
export interface Controls {
  // true if the player is pressing left
  left: boolean;
  // true if the player is pressing right
  right: boolean;
}

// the player's in the game are "jumpers" cause...
// um they jump?
export interface Jumper {
  // The Rune ID for the player controlling this jumper
  id: string;
  // x position of the player as a factory of screen width
  x: number; 
  // y position of the player as a factory of screen width
  y: number; 
  // The highest position this player has reached (their score)
  highest: number;
  // The character type that they're using
  type: number;
  // The velocity vertical component of the player - we don't
  // use velocity horizontally
  vy: number;
  // True if this jumper wants to move left
  left: boolean;
  // True if this jumper wants to move right
  right: boolean;
  // True if this jumper has hit a hazard or fallen off the
  // screen and died
  dead: boolean;
}

// An enemy in the game is a flapping creating (bat or bird)
// that floats across the screen
export interface Enemy {
  // the x position of the enemy as a factory of screen width
  x: number;
  // the y position of the enemy as a factory of screen height
  y: number;
  // the direction in which the enemy is traveling
  dir: "left" | "right";
  // The speed of the enemy - randomized
  speed: number;
  // The type of the enemy - theres only these two
  type: "bird" | "bat"
}

export interface Platform {
  // the x position of the platform as a factory of screen width
  x: number; 
  // the y position of the platform as a factory of screen height
  y: number; 
  // The width of the platform, most of them are the same but theres
  // flexibility here for the first platform
  width: number;
  // True if there are spikes on this platform
  spikes: boolean;
  // True if this platform will fall when jumped on
  faller: boolean;
  // True if this platform is falling and can't be
  // jumped on
  falling: boolean;
  // The velocity of the platform falling down the screen
  vy: number;
  // True if theres a spring on this platform
  spring: boolean;
}

// The rune game state that maintained on all 
// clients and the server by applying actions and 
// the update loop
export interface GameState {
  // The players in the game
  jumpers: Jumper[],
  // The platforms they can jump on
  platforms: Platform[],
  // The enemies that will kill them if they touch
  enemies: Enemy[],
  // The time at which the game starts for all players
  startAt: number,
  // True if the game is in progress and people are jumping!
  jumping: boolean,
  // The time are which the game should restart after the end of the game
  gameRestartTime: number,
  // The theme used for the platforms and backgrounds - randomized per round
  theme: number,
  // The game events that have occurred in the last loop
  events: GameEvent[],
  // The global scores recorded for the player, you get a point for a win
  scores: Record<string, number>;
  // The best heights that each player has reached
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

// Rune actions that can be applied to the game state
type GameActions = {
  // join the game and select a character type
  join: (params: { type: number }) => void
  // update your controls to move your player
  controls: (params: { controls: Controls }) => void;
}

declare global {
  const Rune: RuneClient<GameState, GameActions>
}

// Generate a platform at a particular level - note that we can 
// indicate that the platform is required, this is the case
// where there hasn't been a normal for a while and the player's won't 
// be able to progress without a forced normal platform
function generatePlatform(state: GameState, i: number, requiredPlatform: boolean, lastSpike: number): Platform {
  // generate an x position across the whole screen (or if its a required platform
  // make it roughly central so it can be reached)
  const x = requiredPlatform
    ? 0.5 + (Math.random() * platformWidth * 2) - platformWidth
    : Math.random() * (1 - platformWidth);

  // randomly add in spikes, falling platforms and springs. They all get more
  // likely the further up you go
  const spikes = (i - lastSpike) > 4 && i > 30 && !requiredPlatform && Math.random() < (0.1 + (i / 3000));
  const faller = i > 30 && !requiredPlatform && !spikes && (Math.random() < (0.1 + (i / 3000)));
  const spring = !faller && !spikes && (Math.random() < (0.08 + (i / 5000)));

  // create the actual platform
  state.platforms[i] = {
    x, y: i * rowHeight, width: platformWidth, spikes, faller, falling: false, vy: 0, spring
  }

  return state.platforms[i];
}

// check if we're in game over state, i.e. all the game has started
// and all the players are dead
export function gameOver(state: GameState | undefined): boolean {
  if (!state) {
    return false;
  }
  if (state.startAt === -1) {
    return false;
  }

  return !state.jumpers.find(j => !j.dead) || (Rune.gameTime() - state?.startAt > roundTime);
}

// start a new game and generate the platforms
function startGame(state: GameState): void {
  // clear out the state
  state.jumpers = [];
  state.platforms = [];
  state.enemies = [];

  // select a random theme
  state.theme = Math.floor(Math.random() * 5);
  // create a wide platform at the bottom for players to start
  // on
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
  let lastSpike = 0;
  for (let i = 5; i < 1000; i++) {
    if (i - lastValidRow >= 5) {
      generatePlatform(state, i, true, lastSpike);
      lastValidRow = i;
    } else if (Math.random() < (1 - Math.min(0.8, ((i / 50) * 0.1)))) {
      const platform = generatePlatform(state, i, false, lastSpike);
      if (!platform.spikes && !platform.faller) {
        lastValidRow = i;
      }
      if (platform.spikes) {
        lastSpike = i;
      }
    }
  }

  // randomly spawn some enemies across the map
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

  // and reset the game to starting state
  state.startAt = -1;
  state.jumping = false;
  state.gameRestartTime = -1;
}

Rune.initLogic({
  minPlayers: 1,
  maxPlayers: 4,
  setup: (): GameState => {
    // initial state is just to create the object, it's
    // actually initialized in startGame()
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
      // remove the jumper for the player that left
      context.game.jumpers = context.game.jumpers.filter(j => j.id !== playerId);
    }
  },
  updatesPerSecond: 30,
  update: (context) => {
    const game = context.game;
    game.events = [];

    // if the game is in play and we've reached game over state
    // then stop the game and declare the winner
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
    // once the restart time is reached we go back to character selection
    // and generate a new map
    if (game.gameRestartTime !== -1 && Rune.gameTime() > game.gameRestartTime) {
      startGame(game);
      return;
    }

    // the game hasn't started yet
    if (!game.jumping) {
      // has everyone joined? If so, start the
      // timer for the game beginning
      if (game.jumpers.length === context.allPlayerIds.length) {
        if (game.startAt === -1) {
          game.startAt = Rune.gameTime() + (1000 * 3);
          game.events.push({ type: GameEventType.START_NEW_GAME });
        }
      }

      // if the start timer has run out then start the
      // game and let people start jumping!
      if (game.startAt > 0 && Rune.gameTime() > game.startAt) {
        // start the game
        game.jumping = true;

        // everyone bounces at the start
        for (const playerId of context.allPlayerIds) {
          game.events.push({ type: GameEventType.BOUNCE, playerId });
        }
      }
    } else {
      // we're in game, so we need to move and collide everything

      // for any platform thats falling off the screen move it
      // based on gravity - it is fun to see other people's platforms come flying down
      // from above
      for (const platform of game.platforms) {
        if (platform && platform.falling) {
          platform.vy += gravity;
          platform.y += platform.vy;
        }
      }

      // enemies follow a simple pattern, keep moving until you 
      // hit a screen edge then turn round
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

      // next we're going to go through all the jumpers, we're going to move
      // then in small steps to make the collision detection simple.
      for (const jumper of game.jumpers) {
        // apply gravity to let the players fall
        jumper.vy += gravity;

        // go through 10 steps for movement and collision - we've only got a max
        // or four players and the checks are very light weight so this is more simple
        // than doing a ray cast or similar simultaneous equation.
        const steps = 10;
        for (let i = 0; i < steps; i++) {
          // move a little bit of the velocity step
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
            // we can index since we know that platforms of evenly spaced
            const platform = game.platforms[index];

            // if the platform is falling we can't stand on it 
            if (platform && !platform.falling) {
              // is the jumper on the right horizontal segment to match the platform
              if (jumper.x > platform.x - playerHalfWidth && jumper.x < platform.x + platform.width + playerHalfWidth) {
                // landed on the platform

                // spikes on the platform, kill the player
                if (platform.spikes) {
                  jumper.dead = true;
                  game.events.push({ type: GameEventType.DIE, playerId: jumper.id });
                }
                // if the platform falls when landed on, start the fall
                if (platform.faller) {
                  platform.falling = true;
                }

                // we hit a platform so undo any penetration of the player into the 
                // platform by setting the y co-ordinate to the platform's position
                jumper.y = platform.y;
                // apply the jump - if theres a spring scale it up

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

        // non-step based collision and movement
        if (!jumper.dead) {
          // are we close enough to any enemy - if so, die!
          if (game.enemies.find(e => Math.abs(e.x - jumper.x) < 0.05 && Math.abs(e.y - jumper.y) < 0.05)) {
            // collide with enemy
            jumper.dead = true;
            game.events.push({ type: GameEventType.DIE, playerId: jumper.id });
          }

          // based on what the player is pressing move the character. Note we can 
          // only move to the edges
          if (jumper.right && jumper.x < 1 - playerHalfWidth) {
            jumper.x += moveSpeed;
          }
          if (jumper.left && jumper.x > playerHalfWidth) {
            jumper.x -= moveSpeed;
          }

          // record the highest value if we've gone higher
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
    // join the game and select a player type
    join: ({ type }, context) => {
      const baseX = 0.5 - ((context.allPlayerIds.length - 1) * 0.1);
      const x = (context.allPlayerIds.indexOf(context.playerId) * 0.2) + baseX;

      // create a data model jumper for the player and assign the type
      context.game.jumpers.push({
        x,
        y: rowHeight,
        highest: rowHeight,
        id: context.playerId,
        type,
        // go go power rangers, players start ready to jump!
        vy: defaultJumpPower,
        left: false,
        right: false,
        dead: false
      });
    },
    // update the controls of a player
    controls: ({ controls }, context) => {
      const jumper = context.game.jumpers.find(j => j.id === context.playerId);
      if (jumper) {
        jumper.right = controls.right;
        jumper.left = controls.left;
      }
    }
  },
})
