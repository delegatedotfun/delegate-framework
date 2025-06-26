import { BaseTask } from "../types";
import { DELEGATE_TYPES } from "./constants";

export class CostCalculator {
    static async getCost(task: BaseTask): Promise<number> {
        // instance of deployer
        if (task.type === DELEGATE_TYPES.DEPLOYER) {
            return 0.03;
        }

        return 0;
    }
}