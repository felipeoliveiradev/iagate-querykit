/**
 * Tipo para funções listener de eventos.
 * Recebe argumentos variados e não retorna valor.
 */
type Listener = (...args: any[]) => void;

import { QueryKitConfig } from './config';

/**
 * Gerenciador de eventos para o QueryKit.
 * Permite registrar, remover e emitir eventos com sistema de listeners.
 * Também integra com o event bus global configurado no QueryKitConfig.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * const eventManager = new EventManager();
 * 
 * // Como usar
 * const unsubscribe = eventManager.on('query.executed', (sql, duration) => {
 *   console.log(`Query executada: ${sql} em ${duration}ms`);
 * });
 * 
 * eventManager.emit('query.executed', 'SELECT * FROM users', 150);
 * 
 * // Output: Evento emitido e listener executado
 * // Para parar de escutar: unsubscribe();
 * ```
 */
export class EventManager {
  private listeners: Record<string, Listener[]> = {};

  /**
   * Registra um listener para um evento específico.
   * 
   * @param eventName - Nome do evento para escutar
   * @param listener - Função que será executada quando o evento for emitido
   * @returns Função para cancelar a inscrição do listener
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const eventManager = new EventManager();
   * 
   * // Como usar
   * const unsubscribe = eventManager.on('user.created', (user) => {
   *   console.log('Novo usuário criado:', user);
   * });
   * 
   * // Output: Listener registrado, retorna função de unsubscribe
   * ```
   */
  public on(eventName: string, listener: Listener): () => void {
    if (!this.listeners[eventName]) {
      this.listeners[eventName] = [];
    }
    this.listeners[eventName].push(listener);
    return () => this.off(eventName, listener);
  }

  /**
   * Remove um listener específico de um evento.
   * 
   * @param eventName - Nome do evento
   * @param listener - Função listener a ser removida
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const eventManager = new EventManager();
   * const myListener = (data) => console.log(data);
   * eventManager.on('test.event', myListener);
   * 
   * // Como usar
   * eventManager.off('test.event', myListener);
   * 
   * // Output: Listener removido do evento
   * ```
   */
  public off(eventName: string, listener: Listener): void {
    if (!this.listeners[eventName]) return;
    this.listeners[eventName] = this.listeners[eventName].filter(l => l !== listener);
  }

  /**
   * Emite um evento para todos os listeners registrados.
   * Também emite o evento no event bus global se configurado.
   * 
   * @param eventName - Nome do evento a ser emitido
   * @param args - Argumentos opcionais para passar aos listeners
   * 
   * @example
   * ```typescript
   * // Dados iniciais
   * const eventManager = new EventManager();
   * eventManager.on('data.updated', (table, recordId, changes) => {
   *   console.log(`Dados atualizados em ${table}:`, { recordId, changes });
   * });
   * 
   * // Como usar
   * eventManager.emit('data.updated', 'users', 123, { name: 'John Doe' });
   * 
   * // Output: Evento emitido e todos os listeners executados
   * ```
   */
  public emit(eventName: string, ...args: any[]): void {
    if (this.listeners[eventName]) {
      this.listeners[eventName].forEach(listener => {
        try { listener(...args); } catch (error) { console.error(`Error in event listener for '${eventName}':`, error); }
      });
    }
    if (QueryKitConfig.eventBus) {
      try { QueryKitConfig.eventBus.emit(eventName, ...args); } catch {}
    }
  }
}

/**
 * Instância global do EventManager para uso em todo o QueryKit.
 * Permite que diferentes partes do sistema se comuniquem através de eventos.
 * 
 * @example
 * ```typescript
 * // Dados iniciais
 * import { eventManager } from './event-manager';
 * 
 * // Como usar
 * eventManager.on('query.start', (sql) => {
 *   console.log('Iniciando query:', sql);
 * });
 * 
 * eventManager.emit('query.start', 'SELECT * FROM users');
 * 
 * // Output: Evento global emitido e capturado
 * ```
 */
export const eventManager = new EventManager(); 