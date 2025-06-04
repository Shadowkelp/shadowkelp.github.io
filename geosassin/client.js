// Geosassin v2 - client.js

const socket = io('https://geosassin.onrender.com', {
  withCredentials: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 20000, // Increased timeout for Render cold starts
  transports: ['polling', 'websocket'], // Try polling first, then upgrade
  path: '/socket.io/' // Explicit path
});

// Add more detailed error logging
socket.on('connect_error', (error) => {
  console.error('Connection error details:', {
    type: error.type,
    message: error.message,
    stack: error.stack
  });
  messageDisplay.textContent = "Server connection error. Please try again later.";
  messageDisplay.style.display = 'block';
  messageDisplay.style.color = '#FF6347';
});

// Canvas and rendering context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// UI Elements
const cooldownsDisplay = document.getElementById('cooldownsDisplay');
const messageDisplay = document.getElementById('messageDisplay');
const playerIdDisplay = document.getElementById('playerIdDisplay');

// Game constants from spec
const GRID_WIDTH_CELLS = 40;
const GRID_HEIGHT_CELLS = 40;
const CELL_SIZE = 30;
const PLAYER_ENTITY_GRID_UNITS = 2; // Player is 2x2 cells
const PLAYER_ENTITY_SIZE_PX = PLAYER_ENTITY_GRID_UNITS * CELL_SIZE;

const WINDOW_WIDTH = GRID_WIDTH_CELLS * CELL_SIZE;
const WINDOW_HEIGHT = GRID_HEIGHT_CELLS * CELL_SIZE;

// Colors
const PLAYER_1_COLOR = '#329632'; // Green
const PLAYER_2_COLOR = '#963232'; // Red
const ARROW_COLOR = '#FFFF00'; // Yellow
const MINOR_GRID_LINE_COLOR = '#505050'; // Dark Grey
const MAJOR_GRID_LINE_COLOR = '#909090'; // Lighter Grey
const BACKGROUND_COLOR = '#000000'; // Black

// Directions (consistent with server)
const DIRECTIONS = {
    UP: 'UP',
    DOWN: 'DOWN',
    LEFT: 'LEFT',
    RIGHT: 'RIGHT'
};

// Local player state
let localPlayerId = null;
let localPlayer = null;
let otherPlayer = null;
let gameState = {
    players: {},
    isRoundOver: false,
    winner: null,
    // other global game state properties
};
let activeMovementKeys = []; // Stores currently held down movement keys (DIRECTIONS values)

// --- Canvas Setup ---
canvas.width = WINDOW_WIDTH;
canvas.height = WINDOW_HEIGHT;
ctx.imageSmoothingEnabled = false; // For pixel art style

// --- Input Handling ---
const MOVEMENT_KEYS_MAP = {
    'ArrowUp': DIRECTIONS.UP,
    'ArrowDown': DIRECTIONS.DOWN,
    'ArrowLeft': DIRECTIONS.LEFT,
    'ArrowRight': DIRECTIONS.RIGHT,
};

const ABILITY_KEYS_MAP = {
    '1': 'charge',
    '2': 'ambush',
    '3': 'root',
    '4': 'stun',
    ' ': 'assassinate' // Space bar
};

const CONTROL_KEYS_MAP = {
    'r': 'resetRound',
    'R': 'resetRound'
};

document.addEventListener('keydown', (event) => {
    if (gameState.isRoundOver && !(CONTROL_KEYS_MAP[event.key])) {
        // If round is over, only allow reset key
        return;
    }
    if (localPlayer && localPlayer.isStunned) return; // Cannot act if stunned

    const direction = MOVEMENT_KEYS_MAP[event.key];
    if (direction) {
        event.preventDefault();
        // Remove the key from its current position (if it exists)
        activeMovementKeys = activeMovementKeys.filter(key => key !== direction);
        // Add the key to the end of the array, making it the highest priority
        activeMovementKeys.push(direction);

        // Send movement intention based on the new highest priority key
        socket.emit('playerInput', { type: 'move', direction: getTargetDirection() });
    }

    const ability = ABILITY_KEYS_MAP[event.key];
    if (ability) {
        event.preventDefault();
        if (localPlayer && (localPlayer.isRooted && (ability === 'charge' || ability === 'ambush'))) {
            console.log(`Cannot use ${ability} while rooted.`);
            return;
        }
        socket.emit('playerInput', { type: 'ability', abilityName: ability });
    }

    const controlAction = CONTROL_KEYS_MAP[event.key];
    if (controlAction) {
        event.preventDefault();
        if (controlAction === 'resetRound') {
            socket.emit('requestRoundReset');
        }
    }
});

document.addEventListener('keyup', (event) => {
    const direction = MOVEMENT_KEYS_MAP[event.key];
    if (direction) {
        event.preventDefault();
        // Remove the released key from the active list
        activeMovementKeys = activeMovementKeys.filter(key => key !== direction);

        // If other movement keys are still pressed, send the new target direction
        // If no keys are pressed, getTargetDirection() will be null.
        // The server should handle `direction: null` by not initiating new moves/turns.
        // Or, if activeMovementKeys is empty, we can choose not to send an update,
        // as the player will simply stop initiating new server-side actions.
        // The current server logic for 'move' is `if (!targetDirection) return;`, so sending null or not sending is fine.
        // For consistency and to reflect the change in intention, let's send the new state.
        socket.emit('playerInput', { type: 'move', direction: getTargetDirection() });
    }
});

function getTargetDirection() {
    if (activeMovementKeys.length === 0) return null;
    return activeMovementKeys[activeMovementKeys.length - 1]; // Last key in the array has priority
}

// --- Socket.io Event Handlers ---
socket.on('connect', () => {
    console.log('Connected to server with ID:', socket.id);
});

socket.on('playerAssignment', (assignedId) => {
    localPlayerId = assignedId;
    playerIdDisplay.textContent = `You are: ${localPlayerId}`;
    console.log(`Assigned as ${localPlayerId}`);
});

socket.on('gameStateUpdate', (newState) => {
    gameState = newState;
    if (localPlayerId && gameState.players && gameState.players[localPlayerId]) { // Added check for gameState.players
        localPlayer = gameState.players[localPlayerId];
        // Find the other player
        otherPlayer = null; // Reset before searching
        for (const id in gameState.players) {
            if (id !== localPlayerId) {
                otherPlayer = gameState.players[id];
                break;
            }
        }
    } else {
        localPlayer = null;
        otherPlayer = null;
    }
    updateCooldownsDisplay();
    handleRoundOver();
    requestAnimationFrame(drawGame);
});

socket.on('actionError', (message) => {
    console.warn('Action Error:', message);
    // Display this to the user in a non-intrusive way, e.g., a temporary message area
});

socket.on('roundReset', (initialState) => {
    console.log("Round has been reset.");
    gameState = initialState; // Full state reset
    messageDisplay.style.display = 'none';
    messageDisplay.textContent = '';
    activeMovementKeys = []; // Clear active keys on reset

    if (localPlayerId && gameState.players && gameState.players[localPlayerId]) { // Added check for gameState.players
        localPlayer = gameState.players[localPlayerId];
         // Find the other player after reset
        otherPlayer = null;
        for (const id in gameState.players) {
            if (id !== localPlayerId) {
                otherPlayer = gameState.players[id];
                break;
            }
        }
    } else {
        localPlayer = null;
        otherPlayer = null;
    }

    updateCooldownsDisplay();
    requestAnimationFrame(drawGame); // Redraw with new state
});

socket.on('waitingForPlayer', (message) => {
    messageDisplay.textContent = message;
    messageDisplay.style.color = '#FFFF00'; // Yellow for waiting
    messageDisplay.style.display = 'block';
    // Clear canvas or show a waiting screen
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, WINDOW_WIDTH, WINDOW_HEIGHT);
    drawGrid(); // Keep grid visible
});


// --- Game Logic & Rendering ---

function drawGrid() {
    ctx.strokeStyle = MINOR_GRID_LINE_COLOR;
    ctx.lineWidth = 1;
    // Offset by 0.5 for sharp 1px lines
    for (let x = 0; x <= WINDOW_WIDTH; x += CELL_SIZE) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, WINDOW_HEIGHT);
        ctx.stroke();
    }
    for (let y = 0; y <= WINDOW_HEIGHT; y += CELL_SIZE) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(WINDOW_WIDTH, y + 0.5);
        ctx.stroke();
    }

    ctx.strokeStyle = MAJOR_GRID_LINE_COLOR;
    // Spec: "1-pixel thick lines ... These lines should appear more prominent"
    // Prominence can be achieved by color, or slight thickness increase if desired, but spec says 1px.
    ctx.lineWidth = 1; // Keeping it 1px as per spec, color makes it prominent
    const majorLineInterval = PLAYER_ENTITY_GRID_UNITS * CELL_SIZE;
    for (let x = 0; x <= WINDOW_WIDTH; x += majorLineInterval) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, WINDOW_HEIGHT);
        ctx.stroke();
    }
    for (let y = 0; y <= WINDOW_HEIGHT; y += majorLineInterval) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(WINDOW_WIDTH, y + 0.5);
        ctx.stroke();
    }
}

function drawPlayer(player) {
    if (!player) return;

    const x = player.gridX * CELL_SIZE;
    const y = player.gridY * CELL_SIZE;

    const originalAlpha = ctx.globalAlpha;
    if (player.isRooted || player.isStunned) {
        ctx.globalAlpha = 0.5; // Reduced opacity for body
    }

    // Draw player square
    ctx.fillStyle = player.id === 'player1' ? PLAYER_1_COLOR : PLAYER_2_COLOR;
    ctx.fillRect(x, y, PLAYER_ENTITY_SIZE_PX, PLAYER_ENTITY_SIZE_PX);

    // Arrow rendering (spec: arrow remains fully opaque)
    ctx.globalAlpha = originalAlpha; // Restore alpha for arrow

    ctx.fillStyle = ARROW_COLOR;
    const centerX = x + PLAYER_ENTITY_SIZE_PX / 2;
    const centerY = y + PLAYER_ENTITY_SIZE_PX / 2;
    // Arrow geometry based on spec:
    const tipExtension = PLAYER_ENTITY_SIZE_PX * 0.35;
    const baseLateralOffset = PLAYER_ENTITY_SIZE_PX * 0.25;
    const baseBackwardOffset = PLAYER_ENTITY_SIZE_PX * 0.20; // Offset from center towards back

    ctx.beginPath();
    switch (player.direction) {
        case DIRECTIONS.UP:
            ctx.moveTo(centerX, centerY - tipExtension); // Tip
            ctx.lineTo(centerX - baseLateralOffset, centerY + baseBackwardOffset); // Base left
            ctx.lineTo(centerX + baseLateralOffset, centerY + baseBackwardOffset); // Base right
            break;
        case DIRECTIONS.DOWN:
            ctx.moveTo(centerX, centerY + tipExtension); // Tip
            ctx.lineTo(centerX - baseLateralOffset, centerY - baseBackwardOffset); // Base left
            ctx.lineTo(centerX + baseLateralOffset, centerY - baseBackwardOffset); // Base right
            break;
        case DIRECTIONS.LEFT:
            ctx.moveTo(centerX - tipExtension, centerY); // Tip
            ctx.lineTo(centerX + baseBackwardOffset, centerY - baseLateralOffset); // Base top
            ctx.lineTo(centerX + baseBackwardOffset, centerY + baseLateralOffset); // Base bottom
            break;
        case DIRECTIONS.RIGHT:
            ctx.moveTo(centerX + tipExtension, centerY); // Tip
            ctx.lineTo(centerX - baseBackwardOffset, centerY - baseLateralOffset); // Base top
            ctx.lineTo(centerX - baseBackwardOffset, centerY + baseLateralOffset); // Base bottom
            break;
    }
    ctx.closePath();
    ctx.fill();

    // Restore globalAlpha if it was changed for the body and not for the arrow
    // (already restored before arrow drawing in this version)
    // ctx.globalAlpha = originalAlpha; // Not needed here if restored before arrow
}


function updateCooldownsDisplay() {
    if (!localPlayer || !localPlayer.cooldowns || !localPlayer.lastAbilityTime) {
        cooldownsDisplay.innerHTML = ''; // Clear if no player data
        return;
    }

    const now = Date.now();
    let html = '<div><strong>Abilities:</strong></div>';
    const abilities = ['charge', 'ambush', 'root', 'stun', 'assassinate'];

    abilities.forEach(abilityName => {
        const lastUsed = localPlayer.lastAbilityTime[abilityName] || 0;
        const cooldownDuration = localPlayer.cooldowns[abilityName]; // Should exist from server
        if (cooldownDuration === undefined) {
            console.warn(`Cooldown duration for ${abilityName} is undefined for localPlayer.`);
            html += `<div>${capitalize(abilityName)}: Error</div>`;
            return;
        }
        const timeRemaining = (lastUsed + cooldownDuration) - now;

        if (timeRemaining > 0) {
            html += `<div>${capitalize(abilityName)}: ${(timeRemaining / 1000).toFixed(1)}s</div>`;
        } else {
            html += `<div>${capitalize(abilityName)}: Ready</div>`;
        }
    });
    cooldownsDisplay.innerHTML = html;
}

function capitalize(s) {
    if (typeof s !== 'string') return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function handleRoundOver() {
    if (gameState.isRoundOver) {
        if (gameState.winner === localPlayerId) {
            messageDisplay.textContent = "YOU WIN!";
            messageDisplay.style.color = '#32CD32'; // Lime Green for win
        } else if (gameState.winner && gameState.players && gameState.players[gameState.winner]) { // Check if winner exists in gameState
            messageDisplay.textContent = "YOU LOSE!";
            messageDisplay.style.color = '#FF6347'; // Tomato Red for lose
        } else if (gameState.winner === null && gameState.players && Object.keys(gameState.players).length < 2) {
            // If no winner and fewer than 2 players in state, assume opponent disconnected
            messageDisplay.textContent = "OPPONENT DISCONNECTED";
            messageDisplay.style.color = '#FFFF00'; // Yellow
        } else { // Should ideally not happen if winner is always set on assassinate or handled by disconnect
            messageDisplay.textContent = "ROUND OVER";
            messageDisplay.style.color = '#FFFF00';
        }
        messageDisplay.style.display = 'block';
    } else {
        messageDisplay.style.display = 'none';
    }
}

function drawGame() {
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, WINDOW_WIDTH, WINDOW_HEIGHT);
    drawGrid();

    if (gameState.players) {
        // Draw players based on the server state for consistency
        // Order might matter for overlap, but usually distinct positions
        // Ensure specific player roles are drawn if they exist.
        const p1 = Object.values(gameState.players).find(p => p.id === 'player1');
        const p2 = Object.values(gameState.players).find(p => p.id === 'player2');
        if (p1) drawPlayer(p1);
        if (p2) drawPlayer(p2);
    }

    // Cooldown display is updated in its own loop or after gameStateUpdate
    // No need to call requestAnimationFrame(drawGame) here,
    // as it's already called on gameStateUpdate.
}

// Initial draw or waiting message handling is done via socket events.
// Client-side loop for continuous UI updates like cooldowns.
function clientSideLoop() {
    if (localPlayer && !gameState.isRoundOver) {
        updateCooldownsDisplay(); // Keep cooldowns ticking visually
    }
    requestAnimationFrame(clientSideLoop);
}
clientSideLoop(); // Start the client-side UI update loop

console.log("Geosassin v2 client script loaded. Movement logic updated.");
