import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/api/dialog';
import { BaseDirectory, readDir, writeFile, removeFile, createDir } from '@tauri-apps/api/fs';

class MorimApp {
    constructor() {
        this.ws = null;
        this.currentPlayerId = null;
        this.currentPin = null;
        this.quizzes = [];
        this.avatars = [];
        this.podiums = [];
        this.serverUrl = '';
        this.localIp = '';
        this.editingQuizId = null;
        this.editingQuestionIndex = null;
        
        this.init();
    }

    async init() {
        await this.loadServerInfo();
        this.bindEvents();
        await this.loadQuizzes();
        await this.loadAssets();
        this.connectWebSocket();
        this.setupDragAndDrop();
    }

    async loadServerInfo() {
        try {
            this.serverUrl = await invoke('get_server_url');
            this.localIp = await invoke('get_local_ip');
            
            document.getElementById('serverUrl').textContent = this.serverUrl;
            document.getElementById('serverUrlInput').value = this.serverUrl;
            document.getElementById('localIp').value = this.localIp;
            document.getElementById('publicUrl').value = this.serverUrl;
            document.getElementById('serverPort').value = '8080';
            
            await this.loadQrCode();
        } catch (error) {
            console.error('Failed to load server info:', error);
            this.showToast('Erro ao carregar informações do servidor', 'error');
        }
    }

    async loadQrCode() {
        try {
            const response = await fetch(`${this.serverUrl}/api/qr`);
            const svg = await response.text();
            document.getElementById('qrCode').innerHTML = svg;
        } catch (error) {
            console.error('Failed to load QR code:', error);
        }
    }

    bindEvents() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });

        document.querySelectorAll('.asset-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchAssetTab(btn.dataset.asset));
        });

        document.getElementById('copyUrlBtn').addEventListener('click', () => this.copyToClipboard(this.serverUrl));
        document.getElementById('copyUrlBtn2').addEventListener('click', () => this.copyToClipboard(this.serverUrl));

        document.getElementById('createQuizBtn').addEventListener('click', () => this.openCreateQuizModal());
        document.getElementById('createFirstQuizBtn').addEventListener('click', () => this.openCreateQuizModal());
        document.getElementById('closeCreateQuizModal').addEventListener('click', () => this.closeModal('createQuizModal'));
        document.getElementById('cancelCreateQuiz').addEventListener('click', () => this.closeModal('createQuizModal'));
        document.getElementById('createQuizForm').addEventListener('submit', (e) => this.handleCreateQuiz(e));

        document.getElementById('closeEditQuizModal').addEventListener('click', () => this.closeModal('editQuizModal'));
        document.getElementById('cancelEditQuiz').addEventListener('click', () => this.closeModal('editQuizModal'));
        document.getElementById('saveQuizBtn').addEventListener('click', () => this.saveQuiz());
        document.getElementById('deleteQuizBtn').addEventListener('click', () => this.deleteQuiz());
        document.getElementById('addQuestionBtn').addEventListener('click', () => this.openQuestionModal());

        document.getElementById('closeQuestionModal').addEventListener('click', () => this.closeModal('questionModal'));
        document.getElementById('cancelQuestion').addEventListener('click', () => this.closeModal('questionModal'));
        document.getElementById('questionForm').addEventListener('submit', (e) => this.handleSaveQuestion(e));
        document.getElementById('addOptionBtn').addEventListener('click', () => this.addOptionRow());
        document.getElementById('questionType').addEventListener('change', () => this.updateOptionsForType());

        document.getElementById('avatarUploadArea').addEventListener('click', () => document.getElementById('avatarFileInput').click());
        document.getElementById('avatarFileInput').addEventListener('change', (e) => this.handleAssetUpload(e, 'avatars'));
        document.getElementById('podiumUploadArea').addEventListener('click', () => document.getElementById('podiumFileInput').click());
        document.getElementById('podiumFileInput').addEventListener('change', (e) => this.handleAssetUpload(e, 'podiums'));

        document.getElementById('openDataDirBtn').addEventListener('click', () => this.openDataDirectory());
        document.getElementById('themeSelect').addEventListener('change', (e) => this.applyTheme(e.target.value));
        document.getElementById('primaryColor').addEventListener('change', (e) => this.applyPrimaryColor(e.target.value));

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => this.closeAllModals());
        });

        document.getElementById('serverPort').addEventListener('change', (e) => this.updateServerPort(e.target.value));

        listen('server-started', (event) => {
            this.serverUrl = event.payload.url;
            this.localIp = event.payload.ip;
            document.getElementById('serverUrl').textContent = this.serverUrl;
            document.getElementById('serverUrlInput').value = this.serverUrl;
            document.getElementById('localIp').value = this.localIp;
            document.getElementById('publicUrl').value = this.serverUrl;
            this.loadQrCode();
        });
    }

    switchTab(tabName) {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        document.querySelectorAll('.content').forEach(content => {
            content.classList.toggle('hidden', content.id !== `${tabName}Tab`);
        });
    }

    switchAssetTab(assetType) {
        document.querySelectorAll('.asset-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.asset === assetType);
        });
        document.getElementById('avatarsAssets').classList.toggle('hidden', assetType !== 'avatars');
        document.getElementById('podiumsAssets').classList.toggle('hidden', assetType !== 'podiums');
    }

    async connectWebSocket() {
        const wsUrl = this.serverUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/ws';
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.sendWsMessage({ type: 'RequestQuizList' });
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleWsMessage(msg);
            } catch (error) {
                console.error('Failed to parse WS message:', error);
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected, reconnecting in 3s...');
            setTimeout(() => this.connectWebSocket(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    sendWsMessage(msg) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    handleWsMessage(msg) {
        switch (msg.type) {
            case 'QuizList':
                this.quizzes = msg.payload.quizzes;
                this.renderQuizzes();
                this.updateStats();
                break;
            case 'QuizCreated':
                this.quizzes.push(msg.payload.quiz);
                this.renderQuizzes();
                this.updateStats();
                this.showToast('Quiz criado com sucesso!', 'success');
                break;
            case 'QuizDeleted':
                this.quizzes = this.quizzes.filter(q => q.id !== msg.payload.quiz_id);
                this.renderQuizzes();
                this.updateStats();
                this.showToast('Quiz excluído com sucesso!', 'success');
                break;
            case 'GameJoined':
            case 'PlayerJoined':
            case 'PlayerLeft':
            case 'GameStarted':
            case 'QuestionStarted':
            case 'QuestionEnded':
            case 'LeaderboardUpdate':
            case 'GameEnded':
                this.updateStats();
                break;
            case 'Error':
                this.showToast(msg.payload.message, 'error');
                break;
        }
    }

    async loadQuizzes() {
        try {
            this.quizzes = await invoke('list_quizzes');
            this.renderQuizzes();
            this.updateStats();
        } catch (error) {
            console.error('Failed to load quizzes:', error);
            this.showToast('Erro ao carregar quizzes', 'error');
        }
    }

    renderQuizzes() {
        const container = document.getElementById('quizzesList');
        
        if (this.quizzes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <p>Nenhum quiz criado ainda</p>
                    <button id="createFirstQuizBtn" class="btn btn-primary">Criar Primeiro Quiz</button>
                </div>
            `;
            document.getElementById('createFirstQuizBtn')?.addEventListener('click', () => this.openCreateQuizModal());
            return;
        }

        container.innerHTML = this.quizzes.map(quiz => `
            <div class="quiz-card" data-quiz-id="${quiz.id}">
                <div class="quiz-card-header">
                    <h3 class="quiz-card-title">${this.escapeHtml(quiz.title)}</h3>
                    <div class="quiz-card-actions">
                        <button class="btn btn-icon-sm edit-quiz" title="Editar">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="btn btn-icon-sm delete-quiz" title="Excluir">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <p class="quiz-card-description">${this.escapeHtml(quiz.description || 'Sem descrição')}</p>
                <div class="quiz-card-meta">
                    <span>${quiz.question_count} perguntas</span>
                    <span>${new Date(quiz.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
                <div class="quiz-card-actions">
                    <button class="btn btn-primary play-quiz" style="flex: 1;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                        Iniciar Jogo
                    </button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.edit-quiz').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const quizId = btn.closest('.quiz-card').dataset.quizId;
                this.openEditQuizModal(quizId);
            });
        });

        container.querySelectorAll('.delete-quiz').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const quizId = btn.closest('.quiz-card').dataset.quizId;
                this.confirmDeleteQuiz(quizId);
            });
        });

        container.querySelectorAll('.play-quiz').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const quizId = btn.closest('.quiz-card').dataset.quizId;
                this.startGame(quizId);
            });
        });
    }

    async loadAssets() {
        try {
            this.avatars = await invoke('list_avatars');
            this.podiums = await invoke('list_podiums');
            this.renderAvatars();
            this.renderPodiums();
        } catch (error) {
            console.error('Failed to load assets:', error);
        }
    }

    renderAvatars() {
        const container = document.getElementById('avatarsList');
        
        if (this.avatars.length === 0) {
            container.innerHTML = '<p class="empty-state">Nenhum avatar adicionado ainda</p>';
            return;
        }

        container.innerHTML = this.avatars.map(avatar => `
            <div class="asset-item" data-asset-id="${avatar.id}">
                <div class="asset-preview">
                    <img src="${this.serverUrl}${avatar.file_path}" alt="${this.escapeHtml(avatar.name)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                    <div style="display:none; width:48px; height:48px; color:var(--text-muted);" class="avatar-fallback">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="8" r="5"/>
                            <path d="M20 21a8 8 0 0 0-16 0"/>
                        </svg>
                    </div>
                </div>
                <div class="asset-name">${this.escapeHtml(avatar.name)}</div>
                <div class="asset-actions">
                    <button class="asset-action-btn delete-asset" data-type="avatars" data-id="${avatar.id}" title="Excluir">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.delete-asset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteAsset(btn.dataset.type, btn.dataset.id);
            });
        });
    }

    renderPodiums() {
        const container = document.getElementById('podiumsList');
        
        if (this.podiums.length === 0) {
            container.innerHTML = '<p class="empty-state">Nenhum asset de pódium adicionado ainda</p>';
            return;
        }

        container.innerHTML = this.podiums.map(asset => `
            <div class="asset-item" data-asset-id="${asset.id}">
                <div class="asset-preview">
                    ${asset.asset_type === 'audio' ? `
                        <svg class="audio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M11 5L6 9H2v6h4l5 4V5z"/>
                            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                        </svg>
                    ` : asset.asset_type === 'theme' ? `
                        <svg class="theme-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="5"/>
                            <line x1="12" y1="1" x2="12" y2="3"/>
                            <line x1="12" y1="21" x2="12" y2="23"/>
                            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                            <line x1="1" y1="12" x2="3" y2="12"/>
                            <line x1="21" y1="12" x2="23" y2="12"/>
                            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                        </svg>
                    ` : `
                        <svg class="animation-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <rect x="2" y="2" width="20" height="20" rx="2"/>
                            <path d="M8 12l4 4 6-6"/>
                        </svg>
                    `}
                </div>
                <div class="asset-name">${this.escapeHtml(asset.name)}</div>
                <div class="asset-actions">
                    <button class="asset-action-btn delete-asset" data-type="podiums" data-id="${asset.id}" title="Excluir">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.delete-asset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteAsset(btn.dataset.type, btn.dataset.id);
            });
        });
    }

    setupDragAndDrop() {
        ['avatarUploadArea', 'podiumUploadArea'].forEach(id => {
            const area = document.getElementById(id);
            area.addEventListener('dragover', (e) => {
                e.preventDefault();
                area.classList.add('drag-over');
            });
            area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
            area.addEventListener('drop', (e) => {
                e.preventDefault();
                area.classList.remove('drag-over');
                const type = id === 'avatarUploadArea' ? 'avatars' : 'podiums';
                if (e.dataTransfer.files.length) {
                    this.handleFiles(e.dataTransfer.files, type);
                }
            });
        });
    }

    async handleFiles(files, type) {
        for (const file of files) {
            await this.uploadAsset(file, type);
        }
        await this.loadAssets();
    }

    async handleAssetUpload(event, type) {
        const files = event.target.files;
        await this.handleFiles(files, type);
        event.target.value = '';
    }

    async uploadAsset(file, type) {
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('type', type);

            const response = await fetch(`${this.serverUrl}/api/upload`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            this.showToast(`${file.name} enviado com sucesso!`, 'success');
        } catch (error) {
            console.error('Upload failed:', error);
            this.showToast(`Erro ao enviar ${file.name}`, 'error');
        }
    }

    async deleteAsset(type, id) {
        if (!confirm('Tem certeza que deseja excluir este asset?')) return;

        try {
            const response = await fetch(`${this.serverUrl}/api/assets/${type}/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) throw new Error('Delete failed');

            this.showToast('Asset excluído com sucesso!', 'success');
            await this.loadAssets();
        } catch (error) {
            console.error('Delete failed:', error);
            this.showToast('Erro ao excluir asset', 'error');
        }
    }

    openCreateQuizModal() {
        document.getElementById('createQuizForm').reset();
        document.getElementById('createQuizModal').classList.remove('hidden');
        document.getElementById('quizTitle').focus();
    }

    async openEditQuizModal(quizId) {
        try {
            const quiz = await invoke('get_quiz', { id: quizId });
            this.editingQuizId = quizId;
            
            document.getElementById('editQuizTitle').value = quiz.title;
            document.getElementById('editQuizDescription').value = quiz.description || '';
            document.getElementById('editQuizModalTitle').textContent = `Editar: ${quiz.title}`;
            
            this.renderQuestionsList(quiz.questions || []);
            document.getElementById('editQuizModal').classList.remove('hidden');
        } catch (error) {
            console.error('Failed to load quiz:', error);
            this.showToast('Erro ao carregar quiz', 'error');
        }
    }

    renderQuestionsList(questions) {
        const container = document.getElementById('questionsList');
        
        if (questions.length === 0) {
            container.innerHTML = '<div class="empty-state">Nenhuma pergunta adicionada</div>';
            return;
        }

        container.innerHTML = questions.map((q, index) => `
            <div class="question-item" data-index="${index}">
                <div class="question-item-info">
                    <span class="question-type-badge">${this.formatQuestionType(q.question_type)}</span>
                    <span class="question-text">${this.escapeHtml(q.text)}</span>
                    <span style="color: var(--text-muted); font-size: 0.8125rem;">${q.time_limit}s • ${q.points} pts</span>
                </div>
                <div class="question-actions">
                    <button class="btn btn-icon-sm edit-question" data-index="${index}" title="Editar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn btn-icon-sm delete-question" data-index="${index}" title="Excluir">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.edit-question').forEach(btn => {
            btn.addEventListener('click', () => this.openQuestionModal(parseInt(btn.dataset.index)));
        });

        container.querySelectorAll('.delete-question').forEach(btn => {
            btn.addEventListener('click', () => this.deleteQuestion(parseInt(btn.dataset.index)));
        });
    }

    formatQuestionType(type) {
        const types = {
            'single_choice': 'Escolha Única',
            'multiple_choice': 'Múltipla Escolha',
            'true_false': 'Verdadeiro/Falso',
            'type_answer': 'Digitar Resposta',
            'puzzle': 'Ordenar/Puzzle'
        };
        return types[type] || type;
    }

    openQuestionModal(editIndex = null) {
        this.editingQuestionIndex = editIndex;
        const form = document.getElementById('questionForm');
        form.reset();
        
        document.getElementById('questionModalTitle').textContent = editIndex !== null ? 'Editar Pergunta' : 'Nova Pergunta';
        document.getElementById('questionTime').value = 30;
        document.getElementById('questionPoints').value = 1000;
        
        this.updateOptionsForType();
        
        if (editIndex !== null && this.editingQuizId) {
            const quiz = this.quizzes.find(q => q.id === this.editingQuizId);
            if (quiz && quiz.questions[editIndex]) {
                const q = quiz.questions[editIndex];
                document.getElementById('questionType').value = q.question_type;
                document.getElementById('questionTime').value = q.time_limit;
                document.getElementById('questionPoints').value = q.points;
                document.getElementById('questionText').value = q.text;
                document.getElementById('questionImage').value = q.image_url || '';
                this.renderOptions(q.options || [], q.correct_answer || []);
            }
        }
        
        document.getElementById('questionModal').classList.remove('hidden');
        document.getElementById('questionText').focus();
    }

    updateOptionsForType() {
        const type = document.getElementById('questionType').value;
        const container = document.getElementById('optionsContainer');
        const list = document.getElementById('optionsList');
        
        if (type === 'type_answer' || type === 'true_false') {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        
        if (type === 'true_false') {
            list.innerHTML = `
                <div class="option-row">
                    <input type="checkbox" data-index="0" ${true}>
                    <input type="text" value="Verdadeiro" readonly>
                </div>
                <div class="option-row">
                    <input type="checkbox" data-index="1">
                    <input type="text" value="Falso" readonly>
                </div>
            `;
            return;
        }

        const existingOptions = Array.from(list.querySelectorAll('.option-row')).map((row, i) => ({
            text: row.querySelector('input[type="text"]').value,
            correct: row.querySelector('input[type="checkbox"]').checked
        }));

        let html = '';
        const count = Math.max(existingOptions.length, type === 'puzzle' ? 3 : 4);
        
        for (let i = 0; i < count; i++) {
            const opt = existingOptions[i] || { text: '', correct: false };
            html += `
                <div class="option-row">
                    <input type="checkbox" data-index="${i}" ${opt.correct ? 'checked' : ''}>
                    <input type="text" value="${this.escapeHtml(opt.text)}" placeholder="Opção ${i + 1}" required>
                </div>
            `;
        }
        list.innerHTML = html;
    }

    renderOptions(options, correctAnswers) {
        const list = document.getElementById('optionsList');
        let html = '';
        
        options.forEach((opt, i) => {
            html += `
                <div class="option-row">
                    <input type="checkbox" data-index="${i}" ${correctAnswers.includes(i) ? 'checked' : ''}>
                    <input type="text" value="${this.escapeHtml(opt.text)}" placeholder="Opção ${i + 1}" required>
                </div>
            `;
        });
        list.innerHTML = html;
    }

    addOptionRow() {
        const list = document.getElementById('optionsList');
        const index = list.querySelectorAll('.option-row').length;
        const row = document.createElement('div');
        row.className = 'option-row';
        row.innerHTML = `
            <input type="checkbox" data-index="${index}">
            <input type="text" value="" placeholder="Opção ${index + 1}" required>
            <button type="button" class="btn btn-icon-sm remove-option" title="Remover">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        list.appendChild(row);
        row.querySelector('.remove-option').addEventListener('click', () => row.remove());
    }

    async handleCreateQuiz(event) {
        event.preventDefault();
        const title = document.getElementById('quizTitle').value.trim();
        const description = document.getElementById('quizDescription').value.trim();
        
        if (!title) {
            this.showToast('Título é obrigatório', 'error');
            return;
        }

        try {
            await invoke('create_quiz', { title, description });
            this.closeModal('createQuizModal');
            await this.loadQuizzes();
        } catch (error) {
            console.error('Failed to create quiz:', error);
            this.showToast('Erro ao criar quiz', 'error');
        }
    }

    async saveQuiz() {
        if (!this.editingQuizId) return;

        try {
            const quiz = this.quizzes.find(q => q.id === this.editingQuizId);
            if (!quiz) return;

            quiz.title = document.getElementById('editQuizTitle').value.trim();
            quiz.description = document.getElementById('editQuizDescription').value.trim();
            quiz.updated_at = new Date().toISOString();

            await invoke('create_quiz', { 
                title: quiz.title, 
                description: quiz.description 
            });

            this.closeModal('editQuizModal');
            await this.loadQuizzes();
            this.showToast('Quiz salvo com sucesso!', 'success');
        } catch (error) {
            console.error('Failed to save quiz:', error);
            this.showToast('Erro ao salvar quiz', 'error');
        }
    }

    async deleteQuiz() {
        if (!this.editingQuizId) return;
        if (!confirm('Tem certeza que deseja excluir este quiz permanentemente?')) return;

        try {
            await invoke('delete_quiz', { quiz_id: this.editingQuizId });
            this.closeModal('editQuizModal');
            await this.loadQuizzes();
            this.showToast('Quiz excluído com sucesso!', 'success');
        } catch (error) {
            console.error('Failed to delete quiz:', error);
            this.showToast('Erro ao excluir quiz', 'error');
        }
    }

    confirmDeleteQuiz(quizId) {
        if (!confirm('Tem certeza que deseja excluir este quiz permanentemente?')) return;
        
        invoke('delete_quiz', { quiz_id: quizId })
            .then(() => {
                this.loadQuizzes();
                this.showToast('Quiz excluído com sucesso!', 'success');
            })
            .catch(error => {
                console.error('Failed to delete quiz:', error);
                this.showToast('Erro ao excluir quiz', 'error');
            });
    }

    async handleSaveQuestion(event) {
        event.preventDefault();
        
        const type = document.getElementById('questionType').value;
        const time_limit = parseInt(document.getElementById('questionTime').value);
        const points = parseInt(document.getElementById('questionPoints').value);
        const text = document.getElementById('questionText').value.trim();
        const image_url = document.getElementById('questionImage').value.trim() || null;
        
        if (!text) {
            this.showToast('Texto da pergunta é obrigatório', 'error');
            return;
        }

        let options = [];
        let correct_answer = [];

        if (type !== 'type_answer') {
            const optionRows = document.querySelectorAll('#optionsList .option-row');
            optionRows.forEach((row, i) => {
                const textInput = row.querySelector('input[type="text"]');
                const checkbox = row.querySelector('input[type="checkbox"]');
                if (textInput.value.trim()) {
                    options.push({ text: textInput.value.trim() });
                    if (checkbox.checked) correct_answer.push(i);
                }
            });

            if (options.length < 2 && type !== 'true_false') {
                this.showToast('Adicione pelo menos 2 opções', 'error');
                return;
            }

            if (correct_answer.length === 0 && type !== 'puzzle') {
                this.showToast('Selecione pelo menos uma resposta correta', 'error');
                return;
            }
        }

        const question = {
            text,
            question_type: type,
            options,
            correct_answer,
            time_limit,
            points,
            image_url
        };

        if (this.editingQuestionIndex !== null && this.editingQuizId) {
            const quiz = this.quizzes.find(q => q.id === this.editingQuizId);
            if (quiz) {
                if (this.editingQuestionIndex < quiz.questions.length) {
                    quiz.questions[this.editingQuestionIndex] = { ...quiz.questions[this.editingQuestionIndex], ...question };
                } else {
                    quiz.questions.push(question);
                }
                quiz.updated_at = new Date().toISOString();
                await invoke('create_quiz', { title: quiz.title, description: quiz.description });
            }
        } else if (this.editingQuizId) {
            const quiz = this.quizzes.find(q => q.id === this.editingQuizId);
            if (quiz) {
                quiz.questions.push(question);
                quiz.updated_at = new Date().toISOString();
                await invoke('create_quiz', { title: quiz.title, description: quiz.description });
            }
        }

        this.closeModal('questionModal');
        if (this.editingQuizId) {
            await this.openEditQuizModal(this.editingQuizId);
        }
        this.showToast('Pergunta salva com sucesso!', 'success');
    }

    deleteQuestion(index) {
        if (!confirm('Excluir esta pergunta?')) return;
        
        if (this.editingQuizId) {
            const quiz = this.quizzes.find(q => q.id === this.editingQuizId);
            if (quiz && quiz.questions[index]) {
                quiz.questions.splice(index, 1);
                quiz.updated_at = new Date().toISOString();
                invoke('create_quiz', { title: quiz.title, description: quiz.description })
                    .then(() => this.openEditQuizModal(this.editingQuizId))
                    .catch(error => this.showToast('Erro ao excluir pergunta', 'error'));
            }
        }
    }

    async startGame(quizId) {
        try {
            const quiz = this.quizzes.find(q => q.id === quizId);
            if (!quiz) return;

            const session = {
                quiz_id: quizId,
                host_id: 'host-' + Date.now()
            };

            const response = await fetch(`${this.serverUrl}/api/sessions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(session)
            });

            if (!response.ok) throw new Error('Failed to create session');

            const data = await response.json();
            this.showToast(`Jogo iniciado! PIN: ${data.pin}`, 'success');
            this.updateStats();
        } catch (error) {
            console.error('Failed to start game:', error);
            this.showToast('Erro ao iniciar jogo', 'error');
        }
    }

    updateStats() {
        document.getElementById('totalQuizzes').textContent = this.quizzes.length;
        
        fetch(`${this.serverUrl}/api/stats`)
            .then(r => r.json())
            .then(data => {
                document.getElementById('activePlayers').textContent = data.active_players || 0;
                document.getElementById('activeGames').textContent = data.active_games || 0;
                document.getElementById('totalSessions').textContent = data.total_sessions || 0;
            })
            .catch(() => {});
    }

    async openDataDirectory() {
        try {
            await invoke('open_data_directory');
        } catch (error) {
            console.error('Failed to open data directory:', error);
        }
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }

    applyPrimaryColor(color) {
        document.documentElement.style.setProperty('--accent-primary', color);
        localStorage.setItem('primaryColor', color);
    }

    async updateServerPort(port) {
        this.showToast('Reinicie o aplicativo para aplicar a nova porta', 'info');
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showToast('URL copiada para a área de transferência!', 'success');
        }).catch(() => {
            this.showToast('Erro ao copiar', 'error');
        });
    }

    closeModal(id) {
        document.getElementById(id).classList.add('hidden');
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-message">${this.escapeHtml(message)}</span>
            <button class="toast-close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new MorimApp();
});