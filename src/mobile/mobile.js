// Morim Mobile - Main Application
// WebSocket client for real-time game participation

'use strict';

class MorimMobile {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.pingInterval = null;
        this.gameState = {
            pin: '',
            playerId: null,
            playerName: '',
            selectedAvatar: '',
            currentScreen: 'enter',
            questionIndex: 0,
            totalQuestions: 0,
            score: 0,
            streak: 0,
            answerSubmitted: false,
            timer: null,
            timeLeft: 0,
            avatars: [],
            players: [],
            currentQuestion: null
        };

        this.screens = {
            enter: document.getElementById('screen-enter'),
            profile: document.getElementById('screen-profile'),
            waiting: document.getElementById('screen-waiting'),
            question: document.getElementById('screen-question'),
            feedback: document.getElementById('screen-feedback'),
            final: document.getElementById('screen-final'),
            error: document.getElementById('screen-error')
        };

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadAvatars();
        this.connectWebSocket();
        this.showScreen('enter');
    }

    bindEvents() {
        // PIN Keypad
        document.querySelectorAll('.pin-keypad .key').forEach(key => {
            key.addEventListener('click', () => this.handlePinKey(key.dataset.key));
        });

        // Back button
        document.getElementById('backToPin').addEventListener('click', () => this.showScreen('enter'));

        // Avatar selection
        document.getElementById('avatarGrid').addEventListener('click', (e) => {
            const option = e.target.closest('.avatar-option');
            if (option) this.selectAvatar(option.dataset.avatarId, option.querySelector('img')?.src || option.querySelector('.avatar-placeholder').textContent);
        });

        // Name input
        const nameInput = document.getElementById('playerName');
        nameInput.addEventListener('input', () => this.validateName());
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !document.getElementById('btnJoinGame').disabled) {
                this.joinGame();
            }
        });

        // Join game button
        document.getElementById('btnJoinGame').addEventListener('click', () => this.joinGame());

        // Option buttons (delegated)
        document.getElementById('optionsGrid').addEventListener('click', (e) => {
            const btn = e.target.closest('.option-btn');
            if (btn && !btn.classList.contains('disabled') && !this.gameState.answerSubmitted) {
                this.submitAnswer(btn.dataset.optionIndex);
            }
        });

        // Type answer input
        document.getElementById('optionsGrid').addEventListener('keydown', (e) => {
            if (e.target.matches('.option-btn.type-answer input') && e.key === 'Enter' && !this.gameState.answerSubmitted) {
                const input = e.target;
                if (input.value.trim()) this.submitAnswer(0, input.value.trim());
            }
        });

        // Reconnect button
        document.getElementById('btnReconnect').addEventListener('click', () => this.connectWebSocket());

        // Play again / Leave
        document.getElementById('btnPlayAgain').addEventListener('click', () => this.playAgain());
        document.getElementById('btnLeaveGame').addEventListener('click', () => this.leaveGame());

        // Handle visibility change
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.ws?.readyState === WebSocket.OPEN) {
                this.sendPing();
            }
        });

        // Before unload
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    async loadAvatars() {
        try {
            const response = await fetch('/api/avatars');
            if (response.ok) {
                this.gameState.avatars = await response.json();
                this.renderAvatars();
            }
        } catch (error) {
            console.warn('Could not load avatars:', error);
            this.createDefaultAvatars();
        }
    }

    createDefaultAvatars() {
        const defaults = [
            { id: 'avatar1', name: 'Estrela', file_path: '', file_type: 'emoji', emoji: '⭐' },
            { id: 'avatar2', name: 'Foguete', file_path: '', file_type: 'emoji', emoji: '🚀' },
            { id: 'avatar3', name: 'Robô', file_path: '', file_type: 'emoji', emoji: '🤖' },
            { id: 'avatar4', name: 'Unicórnio', file_path: '', file_type: 'emoji', emoji: '🦄' },
            { id: 'avatar5', name: 'Dragão', file_path: '', file_type: 'emoji', emoji: '🐉' },
            { id: 'avatar6', name: 'Fantasma', file_path: '', file_type: 'emoji', emoji: '👻' },
            { id: 'avatar7', name: 'Panda', file_path: '', file_type: 'emoji', emoji: '🐼' },
            { id: 'avatar8', name: 'Gato', file_path: '', file_type: 'emoji', emoji: '🐱' }
        ];
        this.gameState.avatars = defaults;
        this.renderAvatars();
    }

    renderAvatars() {
        const grid = document.getElementById('avatarGrid');
        grid.innerHTML = this.gameState.avatars.map((avatar, index) => {
            const hasImage = avatar.file_path && avatar.file_type !== 'emoji';
            const src = hasImage ? avatar.file_path : '';
            const placeholder = avatar.emoji || '👤';
            return `
                <button class="avatar-option" data-avatar-id="${avatar.id}" data-avatar-index="${index}" aria-label="${avatar.name}" type="button">
                    ${hasImage ? `<img src="${src}" alt="${avatar.name}" loading="lazy">` : `<span class="avatar-placeholder">${placeholder}</span>`}
                </button>
            `;
        }).join('');

        // Select first by default
        const firstOption = grid.querySelector('.avatar-option');
        if (firstOption) this.selectAvatar(firstOption.dataset.avatarId, firstOption.querySelector('img')?.src || firstOption.querySelector('.avatar-placeholder').textContent);
    }

    selectAvatar(avatarId, avatarSrc) {
        this.gameState.selectedAvatar = avatarId;
        document.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
        const selected = document.querySelector(`.avatar-option[data-avatar-id="${avatarId}"]`);
        if (selected) selected.classList.add('selected');
        this.validateName();
    }

    validateName() {
        const name = document.getElementById('playerName').value.trim();
        const length = name.length;
        document.getElementById('nameLength').textContent = length;
        const btn = document.getElementById('btnJoinGame');
        btn.disabled = length === 0 || length > 20 || !this.gameState.selectedAvatar;
    }

    // ===== PIN Handling =====
    handlePinKey(key) {
        const digits = document.querySelectorAll('.pin-digit');
        const filledCount = Array.from(digits).filter(d => d.classList.contains('filled')).length;

        if (key === 'clear') {
            this.clearPin();
            return;
        }

        if (key === 'enter') {
            if (filledCount === 6) this.verifyPin();
            return;
        }

        if (filledCount < 6 && /^\d$/.test(key)) {
            digits[filledCount].textContent = key;
            digits[filledCount].classList.add('filled');
            this.vibrate(10);

            if (filledCount === 5) {
                setTimeout(() => this.verifyPin(), 300);
            }
        }
    }

    clearPin() {
        document.querySelectorAll('.pin-digit').forEach((d, i) => {
            if (i > 0 || d.classList.contains('filled')) {
                d.textContent = '';
                d.classList.remove('filled', 'error');
            }
        });
        this.gameState.pin = '';
        document.getElementById('pinError').classList.add('hidden');
    }

    verifyPin() {
        const digits = Array.from(document.querySelectorAll('.pin-digit')).map(d => d.textContent).join('');
        if (digits.length !== 6) return;

        this.gameState.pin = digits;
        this.showScreen('profile');
        document.getElementById('playerName').focus();
        document.getElementById('waitingPin').textContent = this.formatPin(digits);
    }

    formatPin(pin) {
        return pin.replace(/(\d{3})(\d{3})/, '$1 $2');
    }

    // ===== WebSocket =====
    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        this.showToast('Conectando...', 'info');
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('[WS] Connected');
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
            this.updateConnectionStatus(true);
            this.hideErrorScreen();
            this.startPing();
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (e) {
                console.error('[WS] Parse error:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('[WS] Disconnected');
            this.stopPing();
            this.updateConnectionStatus(false);
            this.attemptReconnect();
        };

        this.ws.onerror = (error) => {
            console.error('[WS] Error:', error);
            this.showToast('Erro de conexão', 'error');
        };
    }

    startPing() {
        this.stopPing();
        this.pingInterval = setInterval(() => this.sendPing(), 25000);
    }

    stopPing() {
        if (this.pingInterval) clearInterval(this.pingInterval);
    }

    sendPing() {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'Ping' }));
        }
    }

    sendMessage(msg) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        } else {
            this.showToast('Sem conexão com o servidor', 'error');
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.showErrorScreen('Não foi possível reconectar. Verifique sua conexão e tente novamente.');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 10000);

        this.showErrorScreen(`Reconectando... (tentativa ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(() => this.connectWebSocket(), delay);
    }

    // ===== Message Handling =====
    handleMessage(msg) {
        switch (msg.type) {
            case 'GameJoined':
                this.onGameJoined(msg.payload);
                break;
            case 'PlayerJoined':
                this.onPlayerJoined(msg.payload);
                break;
            case 'PlayerLeft':
                this.onPlayerLeft(msg.payload);
                break;
            case 'GameStarted':
                this.onGameStarted(msg.payload);
                break;
            case 'QuestionStarted':
                this.onQuestionStarted(msg.payload);
                break;
            case 'QuestionEnded':
                this.onQuestionEnded(msg.payload);
                break;
            case 'LeaderboardUpdate':
                this.onLeaderboardUpdate(msg.payload);
                break;
            case 'GameEnded':
                this.onGameEnded(msg.payload);
                break;
            case 'Error':
                this.showToast(msg.payload.message, 'error');
                this.handleError(msg.payload.message);
                break;
            case 'Pong':
                break;
            default:
                console.log('[WS] Unknown message:', msg.type);
        }
    }

    onGameJoined(payload) {
        this.gameState.playerId = payload.player_id;
        const session = payload.session;
        this.gameState.players = Object.values(session.players || {});
        this.showScreen('waiting');
        this.updateWaitingRoom();
    }

    onPlayerJoined(payload) {
        this.gameState.players.push(payload.player);
        if (this.gameState.currentScreen === 'waiting') this.updateWaitingRoom();
    }

    onPlayerLeft(payload) {
        this.gameState.players = this.gameState.players.filter(p => p.id !== payload.player_id);
        if (this.gameState.currentScreen === 'waiting') this.updateWaitingRoom();
    }

    onGameStarted(payload) {
        this.gameState.totalQuestions = payload.quiz.questions.length;
        this.gameState.questionIndex = 0;
        this.showScreen('question');
    }

    onQuestionStarted(payload) {
        this.gameState.currentQuestion = payload.question;
        this.gameState.questionIndex = payload.index;
        this.gameState.totalQuestions = payload.total;
        this.gameState.answerSubmitted = false;
        this.gameState.timeLeft = payload.question.time_limit;
        this.renderQuestion();
        this.startTimer(payload.question.time_limit);
    }

    onQuestionEnded(payload) {
        this.stopTimer();
        this.gameState.answerSubmitted = true;

        const result = payload.results?.find(r => r.player_id === this.gameState.playerId);
        const isCorrect = result?.is_correct ?? false;
        const pointsEarned = result?.points_earned ?? 0;

        this.gameState.score += pointsEarned;
        if (isCorrect) {
            this.gameState.streak++;
        } else {
            this.gameState.streak = 0;
        }

        this.showFeedback(isCorrect, pointsEarned, payload.correct_answers, this.gameState.currentQuestion);
    }

    onLeaderboardUpdate(payload) {
        this.updateLeaderboardPreview(payload.leaderboard);
    }

    onGameEnded(payload) {
        this.stopTimer();
        this.showFinalResults(payload.final_leaderboard);
    }

    handleError(message) {
        if (message.includes('PIN') || message.includes('pin')) {
            this.showScreen('enter');
            this.clearPin();
            this.showPinError(message);
        }
    }

    // ===== Screen Management =====
    showScreen(screenName) {
        Object.values(this.screens).forEach(s => s.classList.remove('active'));
        this.screens[screenName]?.classList.add('active');
        this.gameState.currentScreen = screenName;
    }

    showErrorScreen(message) {
        document.getElementById('errorMessage').textContent = message;
        this.showScreen('error');
    }

    hideErrorScreen() {
        if (this.gameState.currentScreen === 'error') {
            if (this.gameState.pin) this.showScreen('profile');
            else this.showScreen('enter');
        }
    }

    updateConnectionStatus(connected) {
        const el = document.getElementById('connectionStatus');
        if (el) {
            el.classList.toggle('disconnected', !connected);
            el.querySelector('span:last-child').textContent = connected ? 'Conectado' : 'Desconectado';
        }
    }

    // ===== Game Flow =====
    joinGame() {
        const name = document.getElementById('playerName').value.trim();
        if (!name || !this.gameState.selectedAvatar) return;

        this.gameState.playerName = name;
        this.sendMessage({
            type: 'JoinGame',
            payload: {
                pin: this.gameState.pin,
                name: name,
                avatar: this.gameState.selectedAvatar
            }
        });
    }

    renderQuestion() {
        const q = this.gameState.currentQuestion;
        if (!q) return;

        document.getElementById('questionCounter').textContent = `Pergunta ${this.gameState.questionIndex + 1} de ${this.gameState.totalQuestions}`;
        document.getElementById('playerScore').textContent = `${this.gameState.score} pts`;
        document.getElementById('questionText').textContent = q.text;

        // Image
        const imgEl = document.getElementById('questionImage');
        if (q.image_url) {
            imgEl.innerHTML = `<img src="${q.image_url}" alt="Imagem da pergunta" loading="lazy">`;
            imgEl.classList.remove('hidden');
        } else {
            imgEl.classList.add('hidden');
        }

        // Options
        const grid = document.getElementById('optionsGrid');
        grid.innerHTML = '';

        const isTypeAnswer = q.question_type === 'type_answer';
        const isTrueFalse = q.question_type === 'true_false';

        if (isTypeAnswer) {
            grid.innerHTML = `
                <button class="option-btn type-answer" data-option-index="0" type="button">
                    <input type="text" placeholder="Digite sua resposta..." autocomplete="off" autocapitalize="words" spellcheck="false" aria-label="Sua resposta">
                </button>
            `;
            setTimeout(() => grid.querySelector('input')?.focus(), 100);
        } else {
            const options = q.options || (isTrueFalse ? [
                { text: 'Verdadeiro' }, { text: 'Falso' }
            ] : []);

            options.forEach((opt, i) => {
                const btn = document.createElement('button');
                btn.className = 'option-btn';
                btn.dataset.optionIndex = i;
                btn.type = 'button';
                btn.textContent = opt.text;
                grid.appendChild(btn);
            });
        }

        // Type hint
        const hintEl = document.getElementById('typeHint');
        const hints = {
            single_choice: 'Selecione uma opção',
            multiple_choice: 'Selecione todas que se aplicam',
            true_false: 'Verdadeiro ou Falso?',
            type_answer: 'Digite a resposta',
            puzzle: 'Arraste para ordenar'
        };
        hintEl.textContent = hints[q.question_type] || '';
    }

    startTimer(seconds) {
        this.gameState.timeLeft = seconds;
        this.updateTimerDisplay();

        this.gameState.timer = setInterval(() => {
            this.gameState.timeLeft--;
            this.updateTimerDisplay();

            if (this.gameState.timeLeft <= 5) {
                document.getElementById('timerContainer').classList.add('warning');
            }
            if (this.gameState.timeLeft <= 3) {
                document.getElementById('timerContainer').classList.add('danger');
            }

            if (this.gameState.timeLeft <= 0) {
                this.stopTimer();
                if (!this.gameState.answerSubmitted) {
                    this.submitAnswer(-1); // Auto-submit timeout
                }
            }
        }, 1000);
    }

    stopTimer() {
        if (this.gameState.timer) {
            clearInterval(this.gameState.timer);
            this.gameState.timer = null;
        }
        document.getElementById('timerContainer').classList.remove('warning', 'danger');
    }

    updateTimerDisplay() {
        const circle = document.getElementById('timerCircle');
        const text = document.getElementById('timerText');
        const total = this.gameState.currentQuestion?.time_limit || 30;
        const progress = 1 - (this.gameState.timeLeft / total);
        const circumference = 2 * Math.PI * 28; // r=28

        text.textContent = this.gameState.timeLeft;
        circle.style.strokeDashoffset = circumference * progress;
    }

    submitAnswer(optionIndex, textAnswer = null) {
        if (this.gameState.answerSubmitted) return;
        this.gameState.answerSubmitted = true;
        this.stopTimer();

        // Visual feedback
        const buttons = document.querySelectorAll('.option-btn');
        buttons.forEach(btn => btn.classList.add('disabled'));

        const answer = textAnswer !== null ? [textAnswer] : [optionIndex];
        this.sendMessage({
            type: 'SubmitAnswer',
            payload: {
                question_id: this.gameState.currentQuestion.id,
                answer: answer
            }
        });

        this.vibrate(50);
    }

    showFeedback(isCorrect, points, correctAnswers, question) {
        const animation = document.getElementById('feedbackAnimation');
        const title = document.getElementById('feedbackTitle');
        const subtitle = document.getElementById('feedbackSubtitle');
        const basePoints = document.getElementById('basePoints');
        const speedBonusRow = document.getElementById('speedBonusRow');
        const speedBonus = document.getElementById('speedBonus');
        const streakRow = document.getElementById('streakRow');
        const streakBonus = document.getElementById('streakBonus');
        const roundTotal = document.getElementById('roundTotal');
        const correctAnswerDisplay = document.getElementById('correctAnswerDisplay');
        const correctAnswerText = document.getElementById('correctAnswerText');

        // Reset
        animation.className = 'feedback-animation';
        title.className = 'feedback-title';
        subtitle.className = 'feedback-subtitle';
        speedBonusRow.classList.add('hidden');
        streakRow.classList.add('hidden');
        correctAnswerDisplay.classList.add('hidden');

        if (isCorrect) {
            animation.classList.add('correct');
            animation.textContent = '✓';
            title.textContent = 'Acertou!';
            title.classList.add('correct');
            subtitle.textContent = `+${points} pontos`;
            basePoints.textContent = `+${points}`;

            // Speed bonus (if answered quickly)
            const timeUsed = (question.time_limit - this.gameState.timeLeft);
            if (timeUsed < question.time_limit * 0.5) {
                const bonus = Math.round(points * 0.2);
                speedBonus.textContent = `+${bonus}`;
                speedBonusRow.classList.remove('hidden');
            }

            // Streak bonus
            if (this.gameState.streak > 1) {
                streakBonus.textContent = `x${this.gameState.streak}`;
                streakRow.classList.remove('hidden');
            }

            this.vibrate([50, 50, 50]);
        } else {
            animation.classList.add('incorrect');
            animation.textContent = '✗';
            title.textContent = 'Errou!';
            title.classList.add('incorrect');
            subtitle.textContent = 'Sem pontos desta vez';
            basePoints.textContent = '+0';

            // Show correct answer
            if (correctAnswers && correctAnswers.length > 0 && question.options) {
                const correctText = correctAnswers.map(i => question.options[i]?.text).filter(Boolean).join(', ');
                correctAnswerText.textContent = correctText;
                correctAnswerDisplay.classList.remove('hidden');
            }

            this.vibrate(200);
        }

        roundTotal.textContent = isCorrect ? `+${points}` : '+0';

        setTimeout(() => this.showScreen('feedback'), 300);
    }

    updateLeaderboardPreview(leaderboard) {
        const list = document.getElementById('leaderboardList');
        list.innerHTML = leaderboard.slice(0, 5).map((entry, i) => `
            <li class="${entry.player_id === this.gameState.playerId ? 'me' : ''}">
                <span class="rank">${i + 1}</span>
                <div class="player-info">
                    ${entry.avatar && entry.avatar !== 'default' ? `<img class="player-avatar" src="${entry.avatar}" alt="">` : `<span class="player-avatar" style="background:linear-gradient(135deg,var(--primary),var(--primary-dark));color:white;display:flex;align-items:center;justify-content:center;font-size:1rem;">${entry.avatar || '👤'}</span>`}
                    <span class="player-name">${entry.name}${entry.player_id === this.gameState.playerId ? ' (você)' : ''}</span>
                </div>
                <span class="player-score">${entry.score} pts</span>
            </li>
        `).join('');
    }

    showFinalResults(leaderboard) {
        // Podium
        const [first, second, third] = leaderboard;
        this.setPodiumPlace('1', first);
        this.setPodiumPlace('2', second);
        this.setPodiumPlace('3', third);

        // My rank
        const myEntry = leaderboard.find(e => e.player_id === this.gameState.playerId);
        const myRank = leaderboard.findIndex(e => e.player_id === this.gameState.playerId) + 1;
        document.getElementById('myRankNumber').textContent = myRank > 0 ? `${myRank}º` : '—';
        document.getElementById('myFinalScore').textContent = `${myEntry?.score || 0} pts`;

        // Stats
        const myStats = this.gameState;
        document.getElementById('finalCorrect').textContent = myStats.streak; // would need tracking
        document.getElementById('finalAccuracy').textContent = '0%'; // would need tracking
        document.getElementById('finalBestStreak').textContent = myStats.streak;

        this.showScreen('final');
        this.playPodiumSound();
    }

    setPodiumPlace(place, entry) {
        if (!entry) return;
        const avatarEl = document.getElementById(`podium${place}Avatar`);
        const nameEl = document.getElementById(`podium${place}Name`);
        const scoreEl = document.getElementById(`podium${place}Score`);

        if (entry.avatar && entry.avatar !== 'default') {
            avatarEl.innerHTML = `<img src="${entry.avatar}" alt="${entry.name}" loading="lazy">`;
        } else {
            avatarEl.innerHTML = `<span class="avatar-placeholder">${entry.avatar || '👤'}</span>`;
        }
        nameEl.textContent = entry.name;
        scoreEl.textContent = `${entry.score} pts`;
    }

    playAgain() {
        this.gameState = {
            ...this.gameState,
            questionIndex: 0,
            score: 0,
            streak: 0,
            answerSubmitted: false,
            currentQuestion: null
        };
        this.sendMessage({ type: 'RequestQuizList' });
        this.showScreen('waiting');
    }

    leaveGame() {
        this.cleanup();
        this.showScreen('enter');
        this.clearPin();
    }

    updateWaitingRoom() {
        const preview = document.getElementById('playersPreview');
        preview.innerHTML = this.gameState.players.map(p => `
            <div class="player-chip ${p.id === this.gameState.playerId ? 'me' : ''}">
                ${p.avatar && p.avatar !== 'default' ? `<img src="${p.avatar}" alt="${p.name}">` : `<span class="avatar-placeholder">${p.avatar || '👤'}</span>`}
                <span>${p.name}${p.id === this.gameState.playerId ? ' (você)' : ''}</span>
            </div>
        `).join('');
    }

    showPinError(message) {
        const errorEl = document.getElementById('pinError');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        document.querySelectorAll('.pin-digit.filled').forEach(d => d.classList.add('error'));
        this.vibrate(200);
    }

    // ===== Toast =====
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('hide');
            toast.addEventListener('animationend', () => toast.remove());
        }, 4000);
    }

    // ===== Helpers =====
    vibrate(pattern) {
        if (navigator.vibrate) navigator.vibrate(pattern);
    }

    playPodiumSound() {
        // Could play a local audio file if available
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
            osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15); // E5
            osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.3); // G5
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
            osc.start();
            osc.stop(ctx.currentTime + 0.8);
        } catch (e) { /* ignore */ }
    }

    cleanup() {
        this.stopTimer();
        this.stopPing();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.morimApp = new MorimMobile();
});

// Service Worker registration for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}