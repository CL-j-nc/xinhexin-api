import csv
import uuid
import datetime

csv_path = '/Users/zhangjunhuai/SHIE人寿新核心承保系统/xinhexin-salesman/public/crm_full_lifecycle_template.csv'
sql_path = '/Users/zhangjunhuai/SHIE人寿新核心承保系统/xinhexin-api/import_data.sql'

with open(csv_path, mode='r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    sql_commands = []
    
    for row in reader:
        vuid = row['vehicle_policy_uid']
        # proposal_id is needed for link everything.
        proposal_id = f"PROP_{vuid}"
        
        # Energy type mapping
        energy_type = row['energy_type'].upper()
        if energy_type in ['GAS', 'PETROL', 'DIESEL', 'FUEL']:
            energy_type = 'FUEL'
        elif energy_type in ['EV', 'NEV', 'ELECTRIC']:
            energy_type = 'NEV'
        else:
            energy_type = 'FUEL' # Default to FUEL
            
        # Date normalization function
        def normalize_date(d_str):
            if not d_str: return d_str
            # Handle YYYY/MM/DD and YYYY/MM/DD HH:MM
            d_str = d_str.replace('/', '-')
            return d_str

        confirmed_at = normalize_date(row['underwriting_confirmed_at'])
        eff_date = normalize_date(row['policy_effective_date'])
        exp_date = normalize_date(row['policy_expiry_date'])

        # 0. Insert into legacy application table (to satisfy policy foreign key)
        # Reflect actual D1 columns: vehicle_data, owner_data, etc.
        sql_commands.append(f"INSERT OR IGNORE INTO application ("
                            f"application_no, status, applied_at, vehicle_data, owner_data, proposer_data, insured_data, coverages_data) VALUES ("
                            f"'{proposal_id}', 'ISSUED', '{confirmed_at}', "
                            f"'{{}}', '{{}}', '{{}}', '{{}}', '[]');")

        # 1. Insert into proposal
        sql_commands.append(f"INSERT OR IGNORE INTO proposal (proposal_id, proposal_status, application_submitted_at, created_at, updated_at) VALUES ('{proposal_id}', 'ISSUED', '{confirmed_at}', datetime('now'), datetime('now'));")
        
        # 2. Insert into vehicle_crm_profile
        sql_commands.append(f"INSERT OR REPLACE INTO vehicle_crm_profile (vehicle_policy_uid, plate, vin, engine_no, brand, model, energy_type, current_status, created_at, updated_at) VALUES ('{vuid}', '{row['plate']}', '{row['vin']}', '{row['engine_no']}', '{row['brand']}', '{row['model']}', '{energy_type}', '正常', datetime('now'), datetime('now'));")
        
        # 3. Insert into vehicle_crm_contacts
        contact_id = f"CNT_{uuid.uuid4().hex[:8]}"
        sql_commands.append(f"INSERT OR REPLACE INTO vehicle_crm_contacts (contact_id, vehicle_policy_uid, role_type, name, id_no, phone, created_at) VALUES ('{contact_id}', '{vuid}', '车主', '{row['owner_name']}', '{row['owner_id_no']}', '{row['owner_phone']}', datetime('now'));")
        
        # 4. Insert into underwriting_manual_decision (Reflect actual D1 columns - handling NOT NULLs)
        decision_id = f"DEC_{uuid.uuid4().hex[:8]}"
        sql_commands.append(f"INSERT OR REPLACE INTO underwriting_manual_decision ("
                            f"decision_id, proposal_id, underwriting_risk_level, underwriting_risk_reason, "
                            f"underwriting_risk_acceptance, usage_authenticity_judgment, usage_verification_basis, "
                            f"loss_history_estimation, loss_history_basis, ncd_assumption, final_premium, "
                            f"premium_adjustment_reason, coverage_adjustment_flag, special_exception_flag, "
                            f"underwriter_name, underwriter_id, underwriting_confirmed_at) VALUES ("
                            f"'{decision_id}', '{proposal_id}', '低等级', '风险可控', '接受投保', '真实', '系统核验', "
                            f"'无赔案', '历史赔付记录正常', '基准级别', {row['final_premium']}, '标准费率', 0, 0, "
                            f"'{row['underwriter_name']}', 'U001', '{confirmed_at}');")
        
        # 5. Insert into policy (Reflect actual D1 columns)
        # coverages_data is NOT NULL, providing a dummy JSON array.
        sql_commands.append(f"INSERT OR REPLACE INTO policy ("
                            f"policy_no, application_no, energy_type, effective_date, expiry_date, plate, vin, "
                            f"brand, vehicle_type, owner_name, owner_id_card, owner_phone, "
                            f"coverages_data, total_premium, status, issued_at) VALUES ("
                            f"'{row['policy_id']}', '{proposal_id}', '{energy_type}', '{eff_date}', '{exp_date}', "
                            f"'{row['plate']}', '{row['vin']}', '{row['brand']}', '{row['model']}', "
                            f"'{row['owner_name']}', '{row['owner_id_no']}', '{row['owner_phone']}', "
                            f"'[]', {row['final_premium']}, 'ACTIVE', '{confirmed_at}');")

    with open(sql_path, 'w', encoding='utf-8') as sql_file:
        sql_file.write("\n".join(sql_commands))
        print(f"SQL script generated: {sql_path}")
