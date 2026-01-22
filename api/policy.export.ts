import { policyStore } from '../store/policyStore';

export function getPolicyTextList(policyId: string): string[] {
    const p = policyStore.get(policyId);
    if (!p) return ['Policy not found'];

    const list: string[] = [];
    list.push(`[POLICY_ID]: ${p.policyId}`);
    list.push(`[STATUS]: ${p.status}`);

    list.push(`[PROPOSER_NAME]: ${p.proposer.name}`);
    list.push(`[PROPOSER_ID_CARD]: ${p.proposer.idCard}`);

    list.push(`[INSURED_NAME]: ${p.insured.name}`);
    list.push(`[INSURED_ID_CARD]: ${p.insured.idCard}`);

    list.push(`[VEHICLE_PLATE]: ${p.vehicle.plate}`);
    list.push(`[VEHICLE_VIN]: ${p.vehicle.vin}`);

    p.coverages.forEach((c, i) => {
        list.push(`[COVERAGE_${i}_TYPE]: ${c.type}`);
        list.push(`[COVERAGE_${i}_LEVEL]: ${c.level}`);
        if (c.amount) list.push(`[COVERAGE_${i}_FINAL_AMOUNT]: ${c.amount}`);
    });

    return list;
}