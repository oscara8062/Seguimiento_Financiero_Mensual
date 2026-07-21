// Firebase se importa de forma dinámica más abajo (solo si hay configuración disponible),
// para que un fallo de red al pedir estos scripts no impida que el resto de la app cargue.

// --- UTILS ---
const utils = {
    formatCurrency: (value) => {
        return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(value);
    },
    formatDate: (dateStr) => {
        if(!dateStr) return '';
        const options = { year: 'numeric', month: 'short', day: 'numeric' };
        return new Date(dateStr + 'T00:00:00').toLocaleDateString('es-CO', options);
    },
    generateId: () => Date.now().toString(36) + Math.random().toString(36).substr(2),
    toast: (title, icon = 'success') => {
        Swal.fire({
            toast: true, position: 'top-end', showConfirmButton: false, timer: 3000,
            icon: icon, title: title,
            background: document.documentElement.classList.contains('dark') ? '#1f2937' : '#ffffff',
            color: document.documentElement.classList.contains('dark') ? '#f3f4f6' : '#111827'
        });
    },
    confirm: async (title, text) => {
        const result = await Swal.fire({
            title: title, text: text, icon: 'warning', showCancelButton: true,
            confirmButtonColor: '#dc2626', cancelButtonColor: '#6b7280',
            confirmButtonText: 'Sí, continuar', cancelButtonText: 'Cancelar',
            background: document.documentElement.classList.contains('dark') ? '#1f2937' : '#ffffff',
            color: document.documentElement.classList.contains('dark') ? '#f3f4f6' : '#111827'
        });
        return result.isConfirmed;
    }
};

// --- DATA ---
const defaultState = {
    movements: [],
    categories: {
        ingreso: ['Salario', 'Horas extras', 'Bonificaciones', 'Negocio', 'Inversiones'],
        gasto: ['Vivienda', 'Alimentación', 'Transporte', 'Salud', 'Educación', 'Entretenimiento', 'Servicios públicos', 'Impuestos', 'Mascotas', 'Otros']
    },
    debts: [],
    budgets: [],
    goals: []
};

let state = JSON.parse(JSON.stringify(defaultState));
let chartsInstance = {};

// Configuración de almacenamiento
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
let db, auth, currentUser, unsubscribeSnapshot, firebaseSDK;

// --- APP LOGIC ---
const app = {
    init: async () => {
        try {
            app.setupUIEvents();
            app.initTheme();

            if (firebaseConfig) {
                try {
                    // Import dinámico: si esta descarga falla (sin red, dominio bloqueado, etc.)
                    // el error se captura aquí y la app sigue funcionando en modo local.
                    const [{ initializeApp }, { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged }, { getFirestore, doc, setDoc, onSnapshot }] = await Promise.all([
                        import("https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js"),
                        import("https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js"),
                        import("https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js")
                    ]);
                    firebaseSDK = { doc, setDoc, onSnapshot };

                    const firebaseApp = initializeApp(firebaseConfig);
                    auth = getAuth(firebaseApp);
                    db = getFirestore(firebaseApp);

                    const initAuth = async () => {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(auth, __initial_auth_token);
                        } else {
                            await signInAnonymously(auth);
                        }
                    };

                    await initAuth();

                    onAuthStateChanged(auth, (user) => {
                        currentUser = user;
                        if (user) {
                            app.listenToData();
                        }
                    });
                } catch (e) {
                    console.error("Firebase Auth Error:", e);
                    app.loadLocalData();
                    app.hideLoader();
                    utils.toast('Ejecutando en modo local (sin DB)', 'warning');
                }
            } else {
                app.loadLocalData();
                app.hideLoader();
            }

            document.getElementById('mov-date').valueAsDate = new Date();
        } catch (e) {
            // Red de seguridad: pase lo que pase arriba, el usuario nunca debe quedarse
            // viendo el spinner de carga para siempre.
            console.error("Error de inicialización:", e);
            app.hideLoader();
        }
    },

    loadLocalData: () => {
        try {
            const saved = localStorage.getItem('finatrack_state');
            if (saved) {
                state = { ...defaultState, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error("Error al leer datos locales:", e);
        }
        app.updateAllViews();
        document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-hard-drive"></i> Guardado local';
    },

    saveLocalData: () => {
        try {
            localStorage.setItem('finatrack_state', JSON.stringify(state));
            document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-check text-success"></i> Guardado local';
        } catch (e) {
            console.error("Error al guardar datos locales:", e);
            document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-triangle-exclamation text-warning"></i> Error al guardar';
        }
        app.updateAllViews();
    },

    listenToData: () => {
        if (!currentUser || !db) return;
        const { doc, onSnapshot } = firebaseSDK;
        const docRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, 'financeData', 'main');
        
        if(unsubscribeSnapshot) unsubscribeSnapshot();
        
        unsubscribeSnapshot = onSnapshot(docRef, (docSnap) => {
            app.hideLoader();
            if (docSnap.exists()) {
                state = { ...defaultState, ...docSnap.data() };
            } else {
                state = JSON.parse(JSON.stringify(defaultState));
                app.saveData(); 
            }
            app.updateAllViews();
            document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-check text-success"></i> Sincronizado';
        }, (error) => {
            console.error("Firestore error:", error);
            utils.toast('Error de conexión a base de datos', 'error');
        });
    },

    saveData: async () => {
        document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-sync fa-spin"></i> Guardando...';
        if (db && currentUser) {
            try {
                const { doc, setDoc } = firebaseSDK;
                const docRef = doc(db, 'artifacts', appId, 'users', currentUser.uid, 'financeData', 'main');
                await setDoc(docRef, state);
                document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-check text-success"></i> Sincronizado';
                app.updateAllViews();
            } catch (e) {
                console.error("Error saving:", e);
                document.getElementById('sync-status').innerHTML = '<i class="fa-solid fa-triangle-exclamation text-warning"></i> Error';
                app.updateAllViews();
            }
        } else {
            app.saveLocalData();
        }
    },

    hideLoader: () => document.getElementById('global-loader').classList.add('hidden'),
    
    initTheme: () => {
        const toggle = document.getElementById('theme-toggle');
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.classList.add('dark');
        }
        toggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            app.renderCharts(); 
        });
    },

    setupUIEvents: () => {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.nav-btn').forEach(b => {
                    b.classList.remove('bg-blue-50', 'dark:bg-blue-900/20', 'text-primary');
                    b.classList.add('text-gray-600', 'dark:text-gray-400');
                });
                const target = e.currentTarget;
                target.classList.remove('text-gray-600', 'dark:text-gray-400');
                target.classList.add('bg-blue-50', 'dark:bg-blue-900/20', 'text-primary');
                
                document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
                document.getElementById(`view-${target.dataset.target}`).classList.remove('hidden');
                
                if(window.innerWidth < 768) document.getElementById('sidebar').classList.add('-translate-x-full');
                
                if(target.dataset.target === 'stats') app.renderCharts();
            });
        });

        document.getElementById('open-sidebar').addEventListener('click', () => document.getElementById('sidebar').classList.remove('-translate-x-full'));
        document.getElementById('close-sidebar').addEventListener('click', () => document.getElementById('sidebar').classList.add('-translate-x-full'));

        document.getElementById('form-movement').addEventListener('submit', app.handleMovementSubmit);
        document.getElementById('form-debt').addEventListener('submit', app.handleDebtSubmit);
        document.getElementById('form-budget').addEventListener('submit', app.handleBudgetSubmit);
        document.getElementById('form-goal').addEventListener('submit', app.handleGoalSubmit);

        document.getElementById('filter-search').addEventListener('input', app.renderMovements);
        document.getElementById('filter-type').addEventListener('change', app.renderMovements);
        document.getElementById('filter-month').addEventListener('change', app.renderMovements);
        
        document.getElementById('import-json').addEventListener('change', app.importBackup);
    },

    updateAllViews: () => {
        app.renderDashboard();
        app.renderMovements();
        app.renderDebts();
        app.renderBudgets();
        app.renderGoals();
        app.renderSettings();
        app.renderCalendar();
        app.generateInsights();
        if(!document.getElementById('view-stats').classList.contains('hidden')) app.renderCharts();
    },

    renderDashboard: () => {
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let totalIncome = 0;
        let totalExpense = 0;
        let monthIncome = 0;
        let monthExpense = 0;

        state.movements.forEach(m => {
            const mDate = new Date(m.date + 'T00:00:00');
            const isCurrentMonth = mDate.getMonth() === currentMonth && mDate.getFullYear() === currentYear;
            
            if (m.type === 'ingreso') {
                totalIncome += m.amount;
                if(isCurrentMonth) monthIncome += m.amount;
            } else {
                totalExpense += m.amount;
                if(isCurrentMonth) monthExpense += m.amount;
            }
        });

        const balance = totalIncome - totalExpense;
        const totalDebt = state.debts.reduce((acc, d) => acc + (d.principal * (d.remaining / (d.remaining + 1))), 0); 
        const totalSavings = state.goals.reduce((acc, g) => acc + g.current, 0);

        document.getElementById('dash-balance').innerText = utils.formatCurrency(balance);
        document.getElementById('dash-income').innerText = utils.formatCurrency(monthIncome);
        document.getElementById('dash-expense').innerText = utils.formatCurrency(monthExpense);
        document.getElementById('dash-debt').innerText = utils.formatCurrency(totalDebt);
        document.getElementById('dash-savings').innerText = utils.formatCurrency(totalSavings);

        const budgetCont = document.getElementById('dash-budget-container');
        budgetCont.innerHTML = '';
        
        const monthExpensesByCategory = {};
        state.movements.filter(m => m.type === 'gasto' && new Date(m.date+'T00:00:00').getMonth() === currentMonth).forEach(m => {
            monthExpensesByCategory[m.category] = (monthExpensesByCategory[m.category] || 0) + m.amount;
        });

        if(state.budgets.length === 0) {
            budgetCont.innerHTML = '<p class="text-sm text-gray-500">No hay presupuestos configurados.</p>';
        } else {
            state.budgets.forEach(b => {
                const spent = monthExpensesByCategory[b.category] || 0;
                const percent = Math.min((spent / b.amount) * 100, 100).toFixed(1);
                let colorClass = 'bg-success';
                if(percent >= 80) colorClass = 'bg-warning';
                if(percent >= 100) colorClass = 'bg-danger';

                budgetCont.innerHTML += `
                    <div>
                        <div class="flex justify-between text-sm mb-1">
                            <span class="font-medium">${b.category}</span>
                            <span>${utils.formatCurrency(spent)} / ${utils.formatCurrency(b.amount)} (${percent}%)</span>
                        </div>
                        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                            <div class="${colorClass} h-2.5 rounded-full" style="width: ${percent}%"></div>
                        </div>
                    </div>
                `;
            });
        }
    },

    renderMovements: () => {
        const tbody = document.getElementById('movements-table-body');
        const search = document.getElementById('filter-search').value.toLowerCase();
        const type = document.getElementById('filter-type').value;
        const monthFilter = document.getElementById('filter-month').value; 

        let filtered = state.movements.filter(m => {
            const matchSearch = m.description.toLowerCase().includes(search) || m.category.toLowerCase().includes(search);
            const matchType = type === '' || m.type === type;
            const matchMonth = monthFilter === '' || m.date.startsWith(monthFilter);
            return matchSearch && matchType && matchMonth;
        });

        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

        tbody.innerHTML = '';
        if(filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-gray-500">No se encontraron movimientos.</td></tr>`;
            return;
        }

        filtered.forEach(m => {
            const isIncome = m.type === 'ingreso';
            const icon = isIncome ? '<i class="fa-solid fa-arrow-trend-up text-success"></i>' : '<i class="fa-solid fa-arrow-trend-down text-danger"></i>';
            
            tbody.innerHTML += `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td class="px-6 py-4">${utils.formatDate(m.date)}</td>
                    <td class="px-6 py-4">${icon} <span class="capitalize ml-1">${m.type}</span></td>
                    <td class="px-6 py-4 font-medium">${m.category}</td>
                    <td class="px-6 py-4">${m.description} ${m.subcat ? `<span class="text-xs text-gray-400 block">${m.subcat}</span>` : ''}</td>
                    <td class="px-6 py-4">${m.paymentMethod}</td>
                    <td class="px-6 py-4 text-right font-bold ${isIncome ? 'text-success' : 'text-gray-900 dark:text-white'}">
                        ${isIncome ? '+' : '-'}${utils.formatCurrency(m.amount)}
                    </td>
                    <td class="px-6 py-4 text-center">
                        <button onclick="app.deleteMovement('${m.id}')" class="text-red-500 hover:text-red-700 p-2"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    },

    renderDebts: () => {
        const container = document.getElementById('debts-container');
        container.innerHTML = '';
        
        if(state.debts.length === 0) {
            container.innerHTML = '<p class="text-gray-500 col-span-full">No hay deudas registradas.</p>';
            return;
        }

        state.debts.forEach(d => {
            container.innerHTML += `
                <div class="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 relative">
                    <button onclick="app.deleteDebt('${d.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500"><i class="fa-solid fa-trash"></i></button>
                    <h3 class="font-bold text-lg mb-1">${d.bank}</h3>
                    <p class="text-xs text-gray-500 mb-4">Día de pago: ${d.payDay} de cada mes</p>
                    
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between"><span class="text-gray-500">Capital Inicial:</span> <span class="font-medium">${utils.formatCurrency(d.principal)}</span></div>
                        <div class="flex justify-between"><span class="text-gray-500">Cuota Mensual:</span> <span class="font-medium text-warning">${utils.formatCurrency(d.installment)}</span></div>
                        <div class="flex justify-between"><span class="text-gray-500">Cuotas Restantes:</span> <span class="font-medium">${d.remaining}</span></div>
                        <div class="flex justify-between"><span class="text-gray-500">Interés Anual:</span> <span class="font-medium">${d.interest}%</span></div>
                    </div>
                    
                    <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                        <p class="text-xs text-gray-500 text-center">Finalización estimada en ${d.remaining} meses.</p>
                    </div>
                </div>
            `;
        });
    },

    renderBudgets: () => {
        const container = document.getElementById('budgets-full-container');
        container.innerHTML = '';
        
        const select = document.getElementById('budget-category');
        select.innerHTML = state.categories.gasto.map(c => `<option value="${c}">${c}</option>`).join('');

        if(state.budgets.length === 0) {
            container.innerHTML = '<p class="text-gray-500 col-span-full">Añade presupuestos para controlar tus gastos.</p>';
            return;
        }

        const currentMonth = new Date().getMonth();
        const monthExpensesByCategory = {};
        state.movements.filter(m => m.type === 'gasto' && new Date(m.date+'T00:00:00').getMonth() === currentMonth).forEach(m => {
            monthExpensesByCategory[m.category] = (monthExpensesByCategory[m.category] || 0) + m.amount;
        });

        state.budgets.forEach(b => {
            const spent = monthExpensesByCategory[b.category] || 0;
            const percent = Math.min((spent / b.amount) * 100, 100).toFixed(1);
            let colorClass = 'bg-success';
            if(percent >= 80) colorClass = 'bg-warning';
            if(percent >= 100) colorClass = 'bg-danger';

            container.innerHTML += `
                <div class="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 relative">
                    <button onclick="app.deleteBudget('${b.category}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500"><i class="fa-solid fa-trash"></i></button>
                    <h3 class="font-bold text-lg mb-2">${b.category}</h3>
                    <div class="flex justify-between text-sm mb-2">
                        <span class="text-gray-500">Consumido: <strong class="${percent>=100?'text-danger':''}">${utils.formatCurrency(spent)}</strong></span>
                        <span class="text-gray-500">Límite: <strong>${utils.formatCurrency(b.amount)}</strong></span>
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 mb-2">
                        <div class="${colorClass} h-3 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
                    </div>
                    <p class="text-xs text-right text-gray-500">${percent}%</p>
                    ${percent >= 100 ? `<p class="text-xs text-danger mt-2"><i class="fa-solid fa-triangle-exclamation"></i> Presupuesto excedido.</p>` : ''}
                    ${percent >= 80 && percent < 100 ? `<p class="text-xs text-warning mt-2"><i class="fa-solid fa-triangle-exclamation"></i> Próximo al límite.</p>` : ''}
                </div>
            `;
        });
    },

    renderGoals: () => {
        const container = document.getElementById('goals-container');
        container.innerHTML = '';
        if(state.goals.length === 0) return container.innerHTML = '<p class="text-gray-500 col-span-full">No hay objetivos financieros. ¡Crea uno!</p>';

        state.goals.forEach(g => {
            const percent = Math.min((g.current / g.target) * 100, 100).toFixed(1);
            container.innerHTML += `
                <div class="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 relative">
                    <button onclick="app.deleteGoal('${g.id}')" class="absolute top-4 right-4 text-gray-400 hover:text-red-500"><i class="fa-solid fa-trash"></i></button>
                    <h3 class="font-bold text-lg mb-4 flex items-center gap-2"><i class="fa-solid fa-star text-yellow-400"></i> ${g.name}</h3>
                    
                    <div class="flex justify-between text-sm mb-1">
                        <span class="font-medium">${utils.formatCurrency(g.current)}</span>
                        <span class="text-gray-500">Meta: ${utils.formatCurrency(g.target)}</span>
                    </div>
                    <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4 mb-2 overflow-hidden">
                        <div class="bg-gradient-to-r from-blue-400 to-blue-600 h-4 rounded-full transition-all duration-500" style="width: ${percent}%"></div>
                    </div>
                    <p class="text-xs text-center font-medium">${percent}% Completado</p>
                </div>
            `;
        });
    },

    renderSettings: () => {
        const renderList = (listId, type) => {
            const ul = document.getElementById(listId);
            ul.innerHTML = '';
            state.categories[type].forEach(cat => {
                ul.innerHTML += `
                    <li class="flex justify-between items-center p-2 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg group">
                        <span>${cat}</span>
                        <button onclick="app.deleteCategory('${type}', '${cat}')" class="text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><i class="fa-solid fa-trash text-sm"></i></button>
                    </li>
                `;
            });
        };
        renderList('cat-income-list', 'ingreso');
        renderList('cat-expense-list', 'gasto');
        app.updateCategoriesDropdown();
    },

    renderCalendar: () => {
        const container = document.getElementById('timeline-container');
        container.innerHTML = '';
        
        const events = [];
        const now = new Date();
        state.debts.forEach(d => {
            events.push({ day: d.payDay, title: `Pago cuota: ${d.bank}`, amount: d.installment, type: 'gasto' });
        });

        events.sort((a, b) => a.day - b.day);

        if(events.length === 0) {
            container.innerHTML = '<p class="text-gray-500">No hay pagos programados.</p>';
            return;
        }

        events.forEach(e => {
            const isPast = now.getDate() > e.day;
            container.innerHTML += `
                <div class="relative mb-6 pl-6">
                    <div class="absolute w-3 h-3 ${isPast ? 'bg-gray-400' : 'bg-primary'} rounded-full -left-[7px] top-1.5 border-2 border-white dark:border-gray-800"></div>
                    <h4 class="font-bold text-sm ${isPast ? 'text-gray-400 line-through' : ''}">Día ${e.day}</h4>
                    <p class="text-sm ${isPast ? 'text-gray-400' : 'text-gray-700 dark:text-gray-300'}">${e.title} - <span class="font-medium text-warning">${utils.formatCurrency(e.amount)}</span></p>
                </div>
            `;
        });
    },

    generateInsights: () => {
        const container = document.getElementById('smart-insights');
        container.innerHTML = '';
        let insights = [];

        const now = new Date();
        const currentMonth = now.getMonth();
        const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate();
        const currentDay = now.getDate();

        let monthExpense = 0;
        let monthIncome = 0;
        state.movements.filter(m => new Date(m.date+'T00:00:00').getMonth() === currentMonth).forEach(m => {
            if(m.type === 'gasto') monthExpense += m.amount;
            else monthIncome += m.amount;
        });

        const dailyAvg = monthExpense / currentDay;
        const projectedExpense = dailyAvg * daysInMonth;
        
        insights.push(`Tu gasto promedio diario este mes es de <strong>${utils.formatCurrency(dailyAvg)}</strong>.`);
        
        if(projectedExpense > monthIncome && monthIncome > 0) {
            insights.push(`<span class="text-red-300"><i class="fa-solid fa-triangle-exclamation"></i> Alerta: A este ritmo, tus gastos proyectados (${utils.formatCurrency(projectedExpense)}) superarán tus ingresos.</span>`);
        }

        if (monthIncome > 0) {
            const recommendedSavings = monthIncome * 0.2;
            insights.push(`Basado en tus ingresos del mes, te sugerimos destinar <strong>${utils.formatCurrency(recommendedSavings)}</strong> (20%) al ahorro o inversión.`);
        }

        if (state.debts.length > 0) {
            const maxInterestDebt = [...state.debts].sort((a,b) => b.interest - a.interest)[0];
            if(maxInterestDebt.interest > 0) {
                insights.push(`Para reducir intereses, te sugerimos hacer abonos extras a la deuda con <strong>${maxInterestDebt.bank}</strong> (Interés: ${maxInterestDebt.interest}%).`);
            }
        }

        if(insights.length === 0) insights.push("Registra más movimientos para generar análisis inteligentes.");

        insights.forEach(text => {
            container.innerHTML += `<li class="flex gap-2 items-start"><i class="fa-solid fa-check-circle text-blue-300 mt-1"></i> <span class="text-sm leading-relaxed">${text}</span></li>`;
        });
    },

    renderCharts: () => {
        const isDark = document.documentElement.classList.contains('dark');
        const textColor = isDark ? '#e5e7eb' : '#374151';
        const gridColor = isDark ? '#374151' : '#e5e7eb';

        Chart.defaults.color = textColor;
        Chart.defaults.font.family = 'Inter';

        const ctxExp = document.getElementById('chartExpenseCategory');
        const ctxFlow = document.getElementById('chartCashFlow');
        const ctxAnn = document.getElementById('chartAnnual');

        Object.values(chartsInstance).forEach(c => c.destroy());

        const currentMonth = new Date().getMonth();
        const expensesByCat = {};
        state.movements.filter(m => m.type === 'gasto' && new Date(m.date+'T00:00:00').getMonth() === currentMonth).forEach(m => {
            expensesByCat[m.category] = (expensesByCat[m.category] || 0) + m.amount;
        });

        chartsInstance.exp = new Chart(ctxExp, {
            type: 'doughnut',
            data: {
                labels: Object.keys(expensesByCat),
                datasets: [{
                    data: Object.values(expensesByCat),
                    backgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#64748b'],
                    borderWidth: 0
                }]
            },
            options: { responsive: true, plugins: { legend: { position: 'right', labels: {color: textColor} } } }
        });

        chartsInstance.flow = new Chart(ctxFlow, {
            type: 'bar',
            data: {
                labels: ['Ingresos', 'Gastos'],
                datasets: [{
                    label: 'Mes Actual',
                    data: [
                        state.movements.filter(m => m.type==='ingreso' && new Date(m.date+'T00:00:00').getMonth() === currentMonth).reduce((a,b)=>a+b.amount,0),
                        state.movements.filter(m => m.type==='gasto' && new Date(m.date+'T00:00:00').getMonth() === currentMonth).reduce((a,b)=>a+b.amount,0)
                    ],
                    backgroundColor: ['#22c55e', '#ef4444'],
                    borderRadius: 6
                }]
            },
            options: { scales: { y: { beginAtZero: true, grid: {color: gridColor}, ticks: {color: textColor} }, x: { grid: {display:false}, ticks: {color: textColor} } }, plugins: { legend: { display: false } } }
        });

        const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        const annIncome = Array(12).fill(0);
        const annExpense = Array(12).fill(0);
        const currentYear = new Date().getFullYear();

        state.movements.forEach(m => {
            const d = new Date(m.date+'T00:00:00');
            if(d.getFullYear() === currentYear) {
                if(m.type === 'ingreso') annIncome[d.getMonth()] += m.amount;
                else annExpense[d.getMonth()] += m.amount;
            }
        });

        chartsInstance.ann = new Chart(ctxAnn, {
            type: 'line',
            data: {
                labels: months,
                datasets: [
                    { label: 'Ingresos', data: annIncome, borderColor: '#22c55e', backgroundColor: '#22c55e10', tension: 0.4, fill: true },
                    { label: 'Gastos', data: annExpense, borderColor: '#ef4444', backgroundColor: '#ef444410', tension: 0.4, fill: true }
                ]
            },
            options: { responsive: true, scales: { y: { beginAtZero: true, grid: {color: gridColor}, ticks: {color: textColor} }, x: { grid: {color: gridColor}, ticks: {color: textColor} } } }
        });
    },

    handleMovementSubmit: (e) => {
        e.preventDefault();
        const type = document.getElementById('mov-type').value;
        const category = document.getElementById('mov-category').value;
        const amount = parseFloat(document.getElementById('mov-amount').value);
        
        const mov = {
            id: document.getElementById('mov-id').value || utils.generateId(),
            type: type,
            date: document.getElementById('mov-date').value,
            category: category,
            amount: amount,
            description: document.getElementById('mov-description').value,
            paymentMethod: document.getElementById('mov-method').value,
            subcat: document.getElementById('mov-subcat').value,
            notes: document.getElementById('mov-notes').value
        };

        if (type === 'gasto') {
            const budget = state.budgets.find(b => b.category === category);
            if (budget) {
                const currentMonth = new Date().getMonth();
                const spent = state.movements.filter(m => m.type === 'gasto' && m.category === category && new Date(m.date+'T00:00:00').getMonth() === currentMonth).reduce((a,b)=>a+b.amount,0);
                const newTotal = spent + amount;
                if(newTotal > budget.amount) {
                    utils.toast(`¡Atención! Has superado el presupuesto para ${category}.`, 'warning');
                } else if (newTotal >= budget.amount * 0.8) {
                    utils.toast(`¡Alerta! Alcanzaste el 80% del presupuesto de ${category}.`, 'warning');
                }
            }
        }

        if(document.getElementById('mov-id').value) {
            const idx = state.movements.findIndex(m => m.id === mov.id);
            state.movements[idx] = mov;
        } else {
            state.movements.push(mov);
        }

        app.saveData();
        app.closeModal('modal-movement');
        e.target.reset();
        document.getElementById('mov-date').valueAsDate = new Date();
        utils.toast('Movimiento guardado exitosamente');
    },

    handleDebtSubmit: (e) => {
        e.preventDefault();
        const debt = {
            id: utils.generateId(),
            bank: document.getElementById('debt-bank').value,
            principal: parseFloat(document.getElementById('debt-principal').value),
            installment: parseFloat(document.getElementById('debt-installment').value),
            interest: parseFloat(document.getElementById('debt-interest').value),
            payDay: parseInt(document.getElementById('debt-day').value),
            remaining: parseInt(document.getElementById('debt-remaining').value)
        };
        state.debts.push(debt);
        app.saveData();
        app.closeModal('modal-debt');
        e.target.reset();
        utils.toast('Deuda registrada');
    },

    handleBudgetSubmit: (e) => {
        e.preventDefault();
        const category = document.getElementById('budget-category').value;
        const amount = parseFloat(document.getElementById('budget-amount').value);
        
        const existingIdx = state.budgets.findIndex(b => b.category === category);
        if(existingIdx >= 0) state.budgets[existingIdx].amount = amount;
        else state.budgets.push({category, amount});

        app.saveData();
        app.closeModal('modal-budget');
        e.target.reset();
        utils.toast('Presupuesto configurado');
    },

    handleGoalSubmit: (e) => {
        e.preventDefault();
        const goal = {
            id: utils.generateId(),
            name: document.getElementById('goal-name').value,
            target: parseFloat(document.getElementById('goal-target').value),
            current: parseFloat(document.getElementById('goal-current').value)
        };
        state.goals.push(goal);
        app.saveData();
        app.closeModal('modal-goal');
        e.target.reset();
        utils.toast('Meta creada');
    },

    deleteMovement: async (id) => {
        if(await utils.confirm('Eliminar Movimiento', '¿Estás seguro de eliminar este registro?')) {
            state.movements = state.movements.filter(m => m.id !== id);
            app.saveData();
            utils.toast('Eliminado');
        }
    },
    deleteDebt: async (id) => {
        if(await utils.confirm('Eliminar Deuda', '¿Borrar este registro?')) {
            state.debts = state.debts.filter(d => d.id !== id);
            app.saveData();
        }
    },
    deleteBudget: async (cat) => {
        if(await utils.confirm('Eliminar Presupuesto', `¿Quitar límite para ${cat}?`)) {
            state.budgets = state.budgets.filter(b => b.category !== cat);
            app.saveData();
        }
    },
    deleteGoal: async (id) => {
        if(await utils.confirm('Eliminar Meta', '¿Borrar objetivo financiero?')) {
            state.goals = state.goals.filter(g => g.id !== id);
            app.saveData();
        }
    },

    addCategory: async (type) => {
        const { value: catName } = await Swal.fire({
            title: 'Nueva Categoría', input: 'text', inputPlaceholder: 'Nombre de la categoría',
            showCancelButton: true, confirmButtonText: 'Guardar'
        });
        if (catName && !state.categories[type].includes(catName)) {
            state.categories[type].push(catName);
            app.saveData();
            utils.toast('Categoría añadida');
        }
    },
    deleteCategory: async (type, cat) => {
        if(await utils.confirm('Eliminar', `¿Borrar la categoría ${cat}?`)) {
            state.categories[type] = state.categories[type].filter(c => c !== cat);
            app.saveData();
        }
    },
    updateCategoriesDropdown: () => {
        const type = document.getElementById('mov-type').value || 'gasto';
        const select = document.getElementById('mov-category');
        select.innerHTML = state.categories[type].map(c => `<option value="${c}">${c}</option>`).join('');
    },

    clearAllData: async () => {
        if(await utils.confirm('PELIGRO', '¿Borrar TODOS tus datos? Esto no se puede deshacer.')) {
            state = JSON.parse(JSON.stringify(defaultState));
            app.saveData();
            utils.toast('Base de datos restablecida', 'success');
        }
    },

    exportToPDF: () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(20);
        doc.text("Reporte Financiero - FinaTrack", 14, 22);
        doc.setFontSize(11);
        doc.text(`Generado: ${new Date().toLocaleDateString('es-CO')}`, 14, 30);

        const data = state.movements.map(m => [
            m.date, m.type.toUpperCase(), m.category, m.description, 
            m.type==='ingreso' ? `+${m.amount}` : `-${m.amount}`
        ]);

        doc.autoTable({
            startY: 40,
            head: [['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Valor']],
            body: data,
            theme: 'striped',
            styles: { fontSize: 9 },
            headStyles: { fillColor: [37, 99, 235] }
        });

        doc.save(`FinaTrack_Reporte_${Date.now()}.pdf`);
        utils.toast('PDF Generado');
    },

    exportToExcel: () => {
        if(state.movements.length === 0) return utils.toast('No hay datos para exportar', 'warning');
        
        const ws = XLSX.utils.json_to_sheet(state.movements);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Movimientos");
        XLSX.writeFile(wb, `FinaTrack_Movimientos_${Date.now()}.xlsx`);
        utils.toast('Excel Exportado');
    },

    exportBackup: () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
        const node = document.createElement('a');
        node.setAttribute("href", dataStr);
        node.setAttribute("download", `FinaTrack_Backup_${Date.now()}.json`);
        document.body.appendChild(node);
        node.click();
        node.remove();
    },

    importBackup: (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const importedState = JSON.parse(e.target.result);
                if(importedState.movements && importedState.categories) {
                    if(await utils.confirm('Restaurar Backup', 'Esto reemplazará tus datos actuales. ¿Continuar?')) {
                        state = importedState;
                        app.saveData();
                        utils.toast('Datos restaurados correctamente');
                    }
                } else {
                    utils.toast('Formato de archivo inválido', 'error');
                }
            } catch (error) {
                utils.toast('Error al leer el archivo JSON', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = ''; 
    },

    showModal: (id) => {
        document.getElementById(id).classList.remove('hidden');
        if(id === 'modal-movement') app.updateCategoriesDropdown();
    },
    closeModal: (id) => {
        document.getElementById(id).classList.add('hidden');
        const form = document.querySelector(`#${id} form`);
        if(form) form.reset();
    }
};

window.addEventListener('DOMContentLoaded', app.init);
window.app = app;