/**
 * Core types for the delegate framework
 */

// Task-related types (core framework types)
export type TaskStatus = 'completed' | 'running' | 'failed' | 'new';
export type ScheduleUnit = 'minutes' | 'hours' | 'days';

export interface ScheduleInterval {
    unit: ScheduleUnit;
    interval: number;
}

export interface BaseTask {
    type: string;
    id: string;
    name: string;
    status: TaskStatus;
    lastRun: Date;
    nextRun: Date | null;
    scheduleEnabled: boolean;
    scheduleInterval: ScheduleInterval;
    createdAt: Date;
    updatedAt: Date;
}