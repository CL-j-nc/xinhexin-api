export type PolicyStatus =
    | 'DRAFT'
    | 'SUBMITTED'
    | 'UNDERWRITING_REJECTED'
    | 'UNDERWRITING_APPROVED'
    | 'PENDING_CLIENT_CONFIRM'
    | 'PAID'
    | 'COMPLETED'
    | 'INVALIDATED';

export interface CoverageLevel {
    type: string;
    level: string;
    amount?: number;
}

export interface PersonInfo {
    name: string;
    idType: string;
    idCard: string;
    mobile: string;
    address: string;
    idImage?: string;
    principalName?: string;
    principalIdCard?: string;
    principalAddress?: string;
    principalIdImage?: string;
}

export interface VehicleInfo {
    plate: string;
    vin: string;
    engineNo: string;
    brand: string;
    registerDate: string;
    vehicleType: string;
    useNature: string;
    curbWeight: string;
    approvedLoad: string;
    approvedPassengers: string;
    licenseImage?: string;
}

export interface Policy {
    policyId: string;
    status: PolicyStatus;
    proposer: PersonInfo;
    insured: PersonInfo;
    vehicle: VehicleInfo;
    coverages: CoverageLevel[];
    underwritingInfo?: {
        rejectReason?: string;
        payment?: {
            alipayQr: string;
        };
        contractToken?: string;
    };
}
