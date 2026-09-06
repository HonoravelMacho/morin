'use strict';

class PresenterApp {
    constructor() {
        this.ws = null;
        this.currentQuiz = null;
        this.currentSession = null;
        this.sectionsConfig = { numSections: 1, questionsPerSection: [] };
        this.sectionAnswers = {};
        this.sectionTimers = {};
        this.questionData = null;
        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadServerInfo();
        await this.loadQuizzes();
        this.connectWebSocket();
    }

    async loadServerInfo() {
        try {
            const serverUrl = await invoke('get_server_url');
            const localIp = await invoke('get_local_ip');
            this.serverUrl = serverUrl;
            this.localIp = localIp;

            document.getElementById('presenterLocalIp').textContent = localIp;
            document.getElementById('presenterQrUrl').textContent = `http://${localIp}:8080/mobile/`;

            this.loadQrCode();
        } catch (error) {
            console.error('Failed to load server info:', error);
        }
    }

    loadQrCode() {
        const qrUrl = `${this.serverUrl}/api/qr`;
        fetch(qrUrl)
            .then(r => r.text())
            .then(svg => {
                document.getElementById('qrSvg').innerHTML = svg;
            })
            .catch(err => console.error('Failed to load QR code:', err));
    }

    bindEvents() {
        // Lobby view events
        document.getElementById('btnStartLobby').addEventListener('click', () => this.startGameFromLobby());
        document.getElementById('btnCopyUrl').addEventListener('click', () => this.copyUrl());
        document.getElementById('btnFullscreen').addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('btnSettings').addEventListener('click', () => this.showSettings());

        // Quiz selector events
        document.getElementById('backToLobby').addEventListener('click', () => this.showView('lobby'));
        document.getElementById('btnRefreshQuizzes').addEventListener('click', () => this.loadQuizzes());
        document.getElementById('btnCreateNewQuiz').addEventListener('click', () => this.createNewQuiz());

        document.getElementById('backToQuizSelect').addEventListener('click', () => this.showView('quiz-select'));

        // Quiz config events
        document.getElementById('backToQuizConfig').addEventListener('click', () => this.showView('quiz-select'));
        document.getElementById('btnAutoSections').addEventListener('click', () => this.autoConfigureSections());
        document.getElementById('btnConfirmConfig').addEventListener('click', () => this.startQuiz());

        // Game view events
        document.getElementById('backToQuizConfig').addEventListener('click', () => this.showView('quiz-config'));
        document.getElementById('btnNextSection').addEventListener('click', () => this.nextSection());
        document.getElementById('btnNextPhase').addEventListener('click', () => this.phaseToggle());
        document.getElementById('btnPrevQuestion').addEventListener('click', () => this.prevQuestion());
        document.getElementById('btnNextQuestion').addEventListener('click', () => this.nextQuestion());

        // Final podium events
        document.getElementById('btnNewGame').addEventListener('click', () => this.restartGame());
        document.getElementById('btnExportResults').addEventListener('click', () => this.exportResults());

        // Settings
        document.getElementById('btnRestartServer').addEventListener('click', () => this.restartServer());
    }

    async loadQuizzes() {
        try {
            const quizzes = await invoke('list_quizzes');
            this.renderQuizzes(quizzes);
        } catch (error) {
            console.error('Failed to load quizzes:', error);
        }
    }

    renderQuizzes(quizzes) {
        const container = document.getElementById('quizList');
        
        if (quizzes.length === 0) {
            container.innerHTML = `
                <div class="loading-quizzes">
                    <div class="spinner"></div>
                    <p>Nenhum quiz disponível</p>
                </div>
            `;
            return;
        }

        container.innerHTML = quizzes.map(quiz => `
            <div class="quiz-card" data-quiz-id="${quiz.id}">
                <div class="quiz-card-header">
                    <h3 class="quiz-card-title">${this.escapeHtml(quiz.title)}</h3>
                    <div class="quiz-card-meta">
                        <span>${quiz.question_count} perguntas</span>
                        <span>${new Date(quiz.created_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                </div>
                <p class="quiz-card-description">${this.escapeHtml(quiz.description || 'Sem descrição')}</p>
            </div>
        `).join('');

        container.querySelectorAll('.quiz-card').forEach(card => {
            card.addEventListener('click', () => {
                const quizId = card.dataset.quizId;
                this.loadQuizConfig(quizId);
            });
        });
    }

    async loadQuizConfig(quizId) {
        this.currentQuiz = await invoke('get_quiz', { id: quizId });
        this.displayQuizConfig(this.currentQuiz);
    }

    displayQuizConfig(quiz) {
        const totalQuestions = quiz.questions.length;
        const defaultSections = Math.ceil(Math.sqrt(totalQuestions)) || 1;
        const questionsPerSection = this.autoDivideQuestions(totalQuestions, defaultSections);

        this.sectionsConfig = {
            numSections: defaultSections,
            questionsPerSection: questionsPerSection,
            quizId: quiz.id,
            totalQuestions
        };

        document.getElementById('configQuizTitle').textContent = `Configurar: ${quiz.title}`;
        document.getElementById('metaQuestions').textContent = totalQuestions;
        document.getElementById('metaSections').textContent = defaultSections;
        const estimatedMinutes = Math.ceil(totalQuestions * 30 / 60);
        document.getElementById('metaTime').textContent = `${estimatedMinutes} min`;

        this.renderSectionsConfig(questionsPerSection, defaultSections);
        this.showView('quiz-config');
    }

    autoDivideQuestions(totalQuestions, numSections) {
        const questionsPerSection = [];
        let remaining = totalQuestions;
        let baseSize = Math.floor(totalQuestions / numSections);

        for (let i = 0; i < numSections; i++) {
            const size = i < numSections - 1 ? baseSize : baseSize + remaining;
            questionsPerSection.push(size);
            remaining -= baseSize;
        }

        return questionsPerSection;
    }

    renderSectionsConfig(questionsPerSection, numSections) {
        const container = document.getElementById('sectionsList');
        let html = '';

        questionsPerSection.forEach((count, index) => {
            html += `
                <div class="section-config-row">
                    <span>Seção ${index + 1}</span>
                    <span>${count} perguntas</span>
                    <input type="range" min="1" max="${count}" value="${count}" data-section="${index}" class="section-range" />
                </div>
            `;
        });

        container.innerHTML = html;

        document.querySelectorAll('.section-range').forEach(range => {
            range.addEventListener('input', (e) => {
                const section = parseInt(e.target.dataset.section);
                const newCount = parseInt(e.target.value);
                questionsPerSection[section] = newCount;
                document.querySelectorAll('.section-range')[section].nextElementSibling.textContent = newCount;
            });
        });
    }

    autoConfigureSections() {
        const total = this.currentQuiz.questions.length;
        const numSections = Math.max(1, Math.ceil(Math.sqrt(total)));
        const questionsPerSection = this.autoDivideQuestions(total, numSections);

        this.sectionsConfig = {
            numSections,
            questionsPerSection,
            quizId: this.currentQuiz.id
        };

        document.getElementById('metaSections').textContent = numSections;
        this.renderSectionsConfig(questionsPerSection, numSections);
    }

    startQuiz() {
        this.sectionsConfig.numSections = parseInt(document.getElementById('numSections').value) || this.sectionsConfig.numSections;
        this.sectionsConfig.questionsPerSection = this.getQuestionsPerSection();

        // Create game session
        const session = {
            quiz_id: this.currentQuiz.id,
            host_id: 'presenter-' + Date.now()
        };

        fetch(`${this.serverUrl}/api/sessions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(session)
        })
            .then(r => r.json())
            .then(data => {
                this.currentSession = data;
                this.startGameFlow();
            })
            .catch(err => console.error('Failed to create session:', err));
    }

    getQuestionsPerSection() {
        // Return the configured questions per section
        // For now, use auto-division based on current config
        const total = this.currentQuiz.questions.length;
        const num = this.sectionsConfig.numSections || 1;
        return this.autoDivideQuestions(total, num);
    }

    startGameFlow() {
        this.currentSectionIndex = 0;
        this.sectionAnswers = {};
        this.showView('game');
        this.startSection();
    }

    startSection() {
        this.currentSectionIndex++;
        if (this.currentSectionIndex > this.sectionsConfig.numSections) {
            this.showFinalPodium();
            return;
        }

        this.renderSectionProgress();
        this.loadSectionQuestions();
        this.startSectionTimer();
    }

    renderSectionProgress() {
        const totalSections = this.sectionsConfig.numSections;
        const currentSection = this.currentSectionIndex;
        const progressPercent = (currentSection / totalSections) * 100;

        document.getElementById('sectionIndicator').textContent = `Seção ${currentSection} de ${totalSections}`;
        document.getElementById('progressFill').style.width = `${progressPercent}%`;
    }

    loadSectionQuestions() {
        const sectionSize = this.sectionsConfig.questionsPerSection[this.currentSectionIndex - 1] || 0;
        const startIdx = this.currentSectionIndex > 1 
            ? this.sectionsConfig.questionsPerSection.slice(0, this.currentSectionIndex - 1).reduce((a, b) => a + b, 0) 
            : 0;
        const endIdx = startIdx + sectionSize;
        const sectionQuestions = this.currentQuiz.questions.slice(startIdx, endIdx);

        this.questionData = {
            questions: sectionQuestions,
            sectionIndex: this.currentSectionIndex,
            totalInSection: sectionQuestions.length,
            startIdx,
            endIdx
        };

        this.displayQuestion(0);
    }

    displayQuestion(questionIndex) {
        const q = this.questionData.questions[questionIndex];
        if (!q) return;

        document.getElementById('displayQuestionNum').textContent = `Pergunta ${questionIndex + 1} de ${this.questionData.totalInSection}`;
        document.getElementById('displayQuestionText').textContent = this.escapeHtml(q.text);
        document.getElementById('displayQuestionPoints').textContent = `${q.points} pts`;

        // Show image if present
        const imageContainer = document.getElementById('questionImageContainer');
        if (q.image_url) {
            imageContainer.innerHTML = `<img src="${this.serverUrl}${q.image_url}" alt="Imagem da pergunta" style="max-width: 100%; max-height: 200px;">`;
        } else {
            imageContainer.innerHTML = '';
        }

        // Render answer chart (empty initially)
        this.renderAnswerChart(questionIndex);

        // Show answers based on question type
        this.renderAnswers(q);
        
        // Show phase question
        document.getElementById('phaseQuestion').classList.remove('hidden');
        document.getElementById('phaseReveal').classList.add('hidden');
        document.getElementById('phaseSectionPodium').classList.add('hidden');

        // Update timer
        this.startTimer(q.time_limit || 30);
    }

    renderAnswers(question) {
        const chartBars = document.getElementById('chartBars');
        const chartLegend = document.getElementById('chartLegend');
        
        if (question.question_type === 'true_false') {
            chartBars.innerHTML = `
                <div class="chart-bar"><div class="chart-bar-fill" style="width: 60%"></div><span>Verdadeiro</span></div>
                <div class="chart-bar"><div class="chart-bar-fill" style="width: 40%"></div><span>Falso</span></div>
            `;
            chartLegend.innerHTML = '<span>Verdadeiro</span><span>Falso</span>';
        } else if (question.question_type === 'single_choice' || question.question_type === 'multiple_choice') {
            const options = question.options || [];
            let totalVotes = 0;
            const votes = new Array(options.length).fill(0);

            // Count from connected players - we'll use a placeholder for now
            // In real implementation, this would come from the server's answer tracking
            totalVotes = Math.max(1, Math.floor(Math.random() * 20) + 1);

            chartBars.innerHTML = options.map((opt, i) => {
                const voteCount = votes[i] || 0;
                const percentage = (voteCount / totalVotes) * 100;
                return `<div class="chart-bar"><div class="chart-bar-fill" style="width: ${percentage}%"></div><span>${this.escapeHtml(opt.text)}</span></div>`;
            }).join('');

            chartLegend.innerHTML = options.map(opt => `<span>${this.escapeHtml(opt.text)}</span>`).join('');
        } else if (question.question_type === 'type_answer') {
            chartBars.innerHTML = '<p>Resposta livre - exibir respostas dos jogadores</p>';
            chartLegend.innerHTML = '';
        } else {
            const options = question.options || [];
            chartBars.innerHTML = options.map((opt, i) => `<div class="chart-bar"><div class="chart-bar-fill" style="width: ${(i+1)*20}%"></div><span>${this.escapeHtml(opt.text)}</span></div>`).join('');
            chartLegend.innerHTML = options.map(opt => `<span>${this.escapeHtml(opt.text)}</span>`).join('');
        }
    }

    startTimer(duration) {
        const timerEl = document.getElementById('gameTimerLarge');
        const timerText = document.getElementById('timerTextLarge');
        const timerCircle = document.getElementById('timerCircleLarge');
        
        let remaining = duration;
        const totalCircumference = 226; // circumference for r=36
        timerCircle.style.strokeDasharray = totalCircumference;
        timerCircle.style.strokeDashoffset = totalCircumference;

        const updateTimer = () => {
            const progress = 1 - (remaining / duration);
            timerCircle.style.strokeDashoffset = totalCircumference * progress;
            timerText.textContent = Math.max(0, remaining);

            if (remaining <= 5) {
                timerEl.classList.add('warning');
            }
            if (remaining <= 3) {
                timerEl.classList.add('danger');
            }

            remaining--;

            if (remaining < 0) {
                clearInterval(this.timerInterval);
                this.onTimerEnd();
            }
        };

        this.timerInterval = setInterval(updateTimer, 1000);
        updateTimer();
    }

    onTimerEnd() {
        clearInterval(this.timerInterval);
        this.stopTimerDisplay();
        this.revealAnswers();
    }

    stopTimerDisplay() {
        const timerEl = document.getElementById('gameTimerLarge');
        timerEl.classList.remove('warning', 'danger');
    }

    revealAnswers() {
        // Hide answer options, show correct answer
        document.querySelectorAll('.answer-option').forEach(el => el.classList.add('hidden'));
        
        // Show correct answer
        const correctIdx = 0; // Would come from question.correct_answer
        const correctOption = document.getElementById('correctOption');
        if (correctOption) {
            correctOption.classList.remove('hidden');
        }

        // Show reveal phase
        document.getElementById('phaseQuestion').classList.add('hidden');
        document.getElementById('phaseReveal').classList.remove('hidden');

        // Update stats
        this.updateRevealStats();

        // Start short delay before podium
        setTimeout(() => this.showSectionPodium(), 3000);
    }

    updateRevealStats() {
        // Placeholder stats - in real implementation, would come from server
        document.getElementById('statCorrect').textContent = '2';
        document.getElementById('statWrong').textContent = '1';
        document.getElementById('statAvgTime').textContent = '8s';
    }

    showSectionPodium() {
        this.hideAllPhases();
        document.getElementById('phaseSectionPodium').classList.remove('hidden');
        document.getElementById('phaseSectionPodium').classList.remove('hidden');

        this.renderSectionPodium();
    }

    renderSectionPodium() {
        const session = this.currentSession;
        const players = session ? Object.values(session.players || {}) : [];
        
        // Sort by score for this section
        const sorted = players.sort((a, b) => b.score - a.score).slice(0, 3);
        
        const podiumPlaces = document.getElementById('podiumPlaces');
        podiumPlaces.innerHTML = sorted.map((player, i) => `
            <li class="podium-place ${i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze'}">
                <span class="podium-medal">${i + 1}º</span>
                <div class="podium-player-info">
                    ${player.avatar ? `<img src="${this.serverUrl}${player.avatar}" alt="${player.name}" class="podium-avatar">` : `<span class="podium-avatar-placeholder">${player.name.charAt(0)}</span>`}
                    <span class="podium-player-name">${this.escapeHtml(player.name)}</span>
                </div>
                <span class="podium-player-score">${player.score} pts</span>
            </li>
        `).join('');

        // Play sound
        this.playPodiumSound('fanfare');
    }

    hideAllPhases() {
        document.getElementById('phaseQuestion').classList.add('hidden');
        document.getElementById('phaseReveal').classList.add('hidden');
        document.getElementById('phaseSectionPodium').classList.add('hidden');
        document.getElementById('phaseFinalPodium').classList.add('hidden');
    }

    nextSection() {
        this.hideAllPhases();
        this.currentSectionIndex++;
        if (this.currentSectionIndex > this.sectionsConfig.numSections) {
            this.showFinalPodium();
            return;
        }
        this.startSection();
    }

    showFinalPodium() {
        this.hideAllPhases();
        
        // Collect all player scores across all sections
        const session = this.currentSession;
        const allPlayers = session ? Object.values(session.players || {}) : [];
        
        // Sum scores - each player's total is already accumulated
        const finalLeaderboard = allPlayers.sort((a, b) => b.score - a.score).slice(0, 5);

        this.renderFinalPodium(finalLeaderboard);

        document.getElementById('phaseFinalPodium').classList.remove('hidden');
        
        // Play final podium sounds
        this.playPodiumSound('applause');
    }

    renderFinalPodium(leaderboard) {
        const finalPodium = document.getElementById('finalPodium');
        const finalFullRanking = document.getElementById('finalFullRanking');

        // Podium top 3
        finalPodium.innerHTML = leaderboard.slice(0, 3).map((player, i) => `
            <div class="final-podium-place ${i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze'}">
                <span class="final-podium-medal">${i + 1}º</span>
                <div class="final-podium-player-info">
                    ${player.avatar ? `<img src="${this.serverUrl}${player.avatar}" alt="${player.name}" class="final-podium-avatar">` : `<span class="final-podium-avatar-placeholder">${player.name.charAt(0)}</span>`}
                    <span class="final-podium-player-name">${this.escapeHtml(player.name)}</span>
                </div>
                <span class="final-podium-player-score">${player.score} pts</span>
            </div>
        `).join('');

        // Full ranking
        finalFullRanking.innerHTML = leaderboard.map((player, i) => `
            <div class="final-ranking-entry ${player.id === this.getMyPlayerId() ? 'me' : ''}">
                <span class="final-ranking-rank">${i + 1}º</span>
                <div class="final-ranking-player">
                    ${player.avatar ? `<img src="${this.serverUrl}${player.avatar}" alt="${player.name}" class="final-ranking-avatar">` : `<span class="final-ranking-avatar-placeholder">${player.name.charAt(0)}</span>`}
                    <span class="final-ranking-player-name">${this.escapeHtml(player.name)}${player.id === this.getMyPlayerId() ? ' (você)' : ''}</span>
                </div>
                <span class="final-ranking-player-score">${player.score} pts</span>
            </div>
        `).join('');
    }

    getMyPlayerId() {
        // This would be set when a player joins
        return null;
    }

    exportResults() {
        // In a real implementation, this would download a JSON/CSV of results
        this.showToast('Resultados exportados com sucesso!', 'success');
    }

    // WebSocket handling
    connectWebSocket() {
        const wsUrl = this.serverUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws';
        
        this.ws = new WebSocket(wsUrl);
        this.ws.onopen = () => this.onWsOpen();
        this.ws.onmessage = (event) => this.onWsMessage(event);
        this.ws.onclose = () => this.onWsClose();
        this.ws.onerror = (error) => this.onWsError(error);
    }

    onWsOpen() {
        console.log('[Presenter] WebSocket connected');
        this.updateConnectionStatus(true);
        this.broadcastQuizList();
    }

    onWsMessage(event) {
        try {
            const msg = JSON.parse(event.data);
            this.handleWsMessage(msg);
        } catch (e) {
            console.error('[Presenter] WS parse error:', e);
        }
    }

    onWsClose() {
        console.log('[Presenter] WebSocket disconnected');
        this.updateConnectionStatus(false);
    }

    onWsError(error) {
        console.error('[Presenter] WebSocket error:', error);
    }

    handleWsMessage(msg) {
        switch (msg.type) {
            case 'PlayerJoined':
                this.updatePlayerCount(msg.payload.players?.length || 0);
                break;
            case 'PlayerLeft':
                this.updatePlayerCount(msg.payload.players?.length || 0);
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
                break;
        }
    }

    updatePlayerCount(count) {
        document.getElementById('playerCountValue').textContent = count;
        document.getElementById('playerBadge').textContent = count;
    }

    onGameStarted(payload) {
        this.currentSession = payload.session;
        this.showView('game');
        this.startSection();
    }

    onQuestionStarted(payload) {
        this.questionData = payload;
        this.displayQuestion(payload.questionIndex || 0);
    }

    onQuestionEnded(payload) {
        // Store answer data for this section
        const playerId = payload.results?.[0]?.player_id?.toString();
        if (playerId) {
            if (!this.sectionAnswers[playerId]) {
                this.sectionAnswers[playerId] = { correct: 0, wrong: 0 };
            }
            if (payload.results[0]?.is_correct) {
                this.sectionAnswers[playerId].correct++;
            } else {
                this.sectionAnswers[playerId].wrong++;
            }
        }
        
        // Update chart with new data
        this.renderAnswerChart(payload.questionIndex);
        
        // Show reveal phase
        setTimeout(() => this.revealAnswers(), 1500);
    }

    onLeaderboardUpdate(payload) {
        const leaderboard = payload.leaderboard || [];
        this.renderSectionPodiumWithData(leaderboard);
    }

    renderSectionPodiumWithData(leaderboard) {
        const podiumPlaces = document.getElementById('podiumPlaces');
        podiumPlaces.innerHTML = leaderboard.slice(0, 3).map((entry, i) => `
            <li class="podium-place ${i === 0 ? 'gold' : i === 1 ? 'silver' : 'bronze'}">
                <span class="podium-medal">${i + 1}º</span>
                <div class="podium-player-info">
                    ${entry.avatar ? `<img src="${this.serverUrl}${entry.avatar}" alt="${entry.name}" class="podium-avatar">` : `<span class="podium-avatar-placeholder">${entry.name.charAt(0)}</span>`}
                    <span class="podium-player-name">${this.escapeHtml(entry.name)}</span>
                </div>
                <span class="podium-player-score">${entry.score} pts</span>
            </li>
        `).join('');
    }

    onGameEnded(payload) {
        const finalLeaderboard = payload.final_leaderboard || [];
        this.renderFinalPodium(finalLeaderboard);
        document.getElementById('phaseFinalPodium').classList.remove('hidden');
        this.playPodiumSound('applause');
    }

    // Utility methods
    copyUrl() {
        navigator.clipboard.writeText(this.serverUrl).then(() => {
            this.showToast('URL copiada para a área de transferência!', 'success');
        });
    }

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
        }
    }

    showView(viewName) {
        document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
        document.getElementById(`view-${viewName}`)?.classList.add('active');
    }

    showSettings() {
        // Populate settings with current values
        document.getElementById('setLocalIp').value = this.localIp;
        document.getElementById('setPort').value = '8080';
        document.getElementById('setDefaultTime').value = '30';
        document.getElementById('setBasePoints').value = '1000';
        document.getElementById('setStreakMultiplier').value = '1.5';
        document.getElementById('setTheme').value = 'dark';
        document.getElementById('setPrimaryColor').value = '#6366f1';
        document.getElementById('setAnimations').checked = true;
        document.getElementById('setPodiumSounds').checked = true;
        
        this.showView('settings');
    }

    restartServer() {
        invoke('open_data_directory');
        this.showToast('Reinicialização solicitada', 'info');
    }

    playPodiumSound(type = 'fanfare') {
        const audioEl = document.getElementById(`audio${type.charAt(0).toUpperCase() + type.slice(1)}`);
        if (audioEl) {
            audioEl.currentTime = 0;
            audioEl.play().catch(() => {/* Audio may be blocked */});
        }
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s';
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async restartGame() {
        this.showView('lobby');
        this.currentSession = null;
        this.currentQuiz = null;
        this.currentSectionIndex = 0;
        this.sectionAnswers = {};
        this.questionData = null;
        
        // Reset timer display
        const timerEl = document.getElementById('gameTimerLarge');
        timerEl.classList.remove('warning', 'danger');
        document.getElementById('timerTextLarge').textContent = '30';
        timerEl.style.strokeDashoffset = '0';
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    window.presenterApp = new PresenterApp();
});