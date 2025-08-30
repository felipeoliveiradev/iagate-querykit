/**
 * Tipo para tarefas agendadas.
 * Função que será executada periodicamente pelo scheduler.
 */
type Task = () => void;

/**
 * Mapa de timers ativos, indexados por nome.
 * Permite gerenciar múltiplas tarefas agendadas simultaneamente.
 */
const timers = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Scheduler para agendar e gerenciar tarefas periódicas.
 * Permite executar funções em intervalos regulares e cancelar execuções futuras.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const cleanupTask = () => console.log('Limpando dados antigos...');
 * const backupTask = () => console.log('Fazendo backup...');
 * 
 * // Como usar
 * scheduler.schedule('cleanup', cleanupTask, 60000); // A cada 1 minuto
 * scheduler.schedule('backup', backupTask, 3600000); // A cada 1 hora
 * 
 * // Para cancelar
 * scheduler.unschedule('cleanup');
 * 
 * // Output: Tarefas agendadas e executando periodicamente
 * ```
 */
export const scheduler = {
  /**
   * Agenda uma tarefa para execução periódica.
   * Se já existir uma tarefa com o mesmo nome, cancela a anterior.
   * 
   * @param name - Nome único para identificar a tarefa
   * @param task - Função a ser executada periodicamente
   * @param intervalMs - Intervalo em milissegundos entre execuções
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const healthCheck = () => {
   *   console.log('Verificando saúde do sistema...');
   * };
   * 
   * // Como usar
   * scheduler.schedule('health-check', healthCheck, 30000);
   * 
   * // Output: Tarefa 'health-check' agendada para executar a cada 30 segundos
   * ```
   */
  schedule(name: string, task: Task, intervalMs: number) {
    scheduler.unschedule(name);
    const t = setInterval(task, intervalMs);
    timers.set(name, t);
  },

  /**
   * Cancela uma tarefa agendada pelo nome.
   * Para a execução periódica e remove o timer da memória.
   * 
   * @param name - Nome da tarefa a ser cancelada
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * scheduler.schedule('temp-task', () => console.log('temp'), 1000);
   * 
   * // Como usar
   * scheduler.unschedule('temp-task');
   * 
   * // Output: Tarefa 'temp-task' cancelada e timer removido
   * ```
   */
  unschedule(name: string) {
    const t = timers.get(name);
    if (t) {
      clearInterval(t);
      timers.delete(name);
    }
  },
}; 