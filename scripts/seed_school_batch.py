import os
import psycopg2


def load_env(path: str) -> None:
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_env("../.env.local")

DB_HOST = os.getenv("DATABASE_HOST")
DB_PORT = int(os.getenv("DATABASE_PORT", "5432"))
DB_USER = os.getenv("DATABASE_USER")
DB_PASSWORD = os.getenv("DATABASE_PASSWORD")
DB_NAME = os.getenv("DATABASE_NAME")

if not all([DB_HOST, DB_USER, DB_PASSWORD, DB_NAME]):
    raise RuntimeError("Missing database env vars (DATABASE_HOST/USER/PASSWORD/NAME)")


MAPPING_DATA = """
EnableStudents_11_25_Engg_C01	CoE	JNV Adilabad
EnableStudents_11_25_Engg_C02	CoE	JNV Barwani
EnableStudents_11_25_Engg_C03	CoE	JNV Bundi
EnableStudents_11_25_Engg_C04	CoE	JNV Chandigarh
EnableStudents_11_25_Engg_C05	CoE	JNV Cuttack
EnableStudents_11_25_Engg_C06	CoE	JNV Burdwan
EnableStudents_11_25_Engg_C07	CoE	JNV Hassan
EnableStudents_11_25_Engg_C08	CoE	JNV Kohima
EnableStudents_11_25_Engg_C09	CoE	JNV Kokrajhar
EnableStudents_11_25_Engg_C10	CoE	JNV Kolhapur
EnableStudents_11_25_Engg_C11	CoE	JNV Kottayam
EnableStudents_11_25_Engg_C12	CoE	JNV Kurnool
EnableStudents_11_25_Engg_C13	CoE	JNV Lucknow
EnableStudents_11_25_Engg_C14	CoE	JNV Mahisagar
EnableStudents_11_25_Engg_C16	CoE	JNV Palghar
EnableStudents_11_25_Engg_C17	CoE	JNV Puducherry
EnableStudents_11_25_Engg_C18	CoE	JNV Thiruvananthapuram
EnableStudents_11_25_Engg_N01	Nodal	JNV Adilabad
EnableStudents_11_25_Engg_N02	Nodal	JNV Bharuch
EnableStudents_11_25_Engg_N03	Nodal	JNV Chamarajanagar
EnableStudents_11_25_Engg_N04	Nodal	JNV Chandrapur
EnableStudents_11_25_Engg_N05	Nodal	JNV Hassan
EnableStudents_11_25_Engg_N06	Nodal	JNV Karimnagar
EnableStudents_11_25_Engg_N07	Nodal	JNV Mandya
EnableStudents_11_25_Engg_N08	Nodal	JNV Nagpur
EnableStudents_11_25_Engg_N09	Nodal	JNV South Canara
EnableStudents_11_25_Engg_N10	Nodal	JNV Udupi
EnableStudents_11_25_Engg_N11	Nodal	JNV Wardha
EnableStudents_11_25_Med_C04	CoE	JNV Chandigarh
EnableStudents_11_25_Med_C08	CoE	JNV Kohima
EnableStudents_11_25_Med_C09	CoE	JNV Kokrajhar
EnableStudents_11_25_Med_C15	CoE	JNV Medak
EnableStudents_11_25_Med_N01	Nodal	JNV Adilabad
EnableStudents_11_25_Med_N02	Nodal	JNV Bharuch
EnableStudents_11_25_Med_N03	Nodal	JNV Chamarajanagar
EnableStudents_11_25_Med_N04	Nodal	JNV Chandrapur
EnableStudents_11_25_Med_N05	Nodal	JNV Hassan
EnableStudents_11_25_Med_N06	Nodal	JNV Karimnagar
EnableStudents_11_25_Med_N07	Nodal	JNV Mandya
EnableStudents_11_25_Med_N08	Nodal	JNV Nagpur
EnableStudents_11_25_Med_N09	Nodal	JNV South Canara
EnableStudents_11_25_Med_N10	Nodal	JNV Udupi
EnableStudents_11_25_Med_N11	Nodal	JNV Wardha
EnableStudents_12_25_Engg_C01	CoE	JNV Adilabad
EnableStudents_12_25_Engg_C02	CoE	JNV Barwani
EnableStudents_12_25_Engg_C03	CoE	JNV Bundi
EnableStudents_12_25_Engg_C04	CoE	JNV Chandigarh
EnableStudents_12_25_Engg_C05	CoE	JNV Cuttack
EnableStudents_12_25_Engg_C07	CoE	JNV Hassan
EnableStudents_12_25_Engg_C08	CoE	JNV Kohima
EnableStudents_12_25_Engg_C09	CoE	JNV Kokrajhar
EnableStudents_12_25_Engg_C11	CoE	JNV Kottayam
EnableStudents_12_25_Engg_C12	CoE	JNV Kurnool
EnableStudents_12_25_Engg_C13	CoE	JNV Lucknow
EnableStudents_12_25_Engg_C18	CoE	JNV Thiruvananthapuram
EnableStudents_12_25_Engg_N01	Nodal	JNV Adilabad
EnableStudents_12_25_Engg_N02	Nodal	JNV Bharuch
EnableStudents_12_25_Engg_N03	Nodal	JNV Chamarajanagar
EnableStudents_12_25_Engg_N04	Nodal	JNV Chandrapur
EnableStudents_12_25_Engg_N05	Nodal	JNV Hassan
EnableStudents_12_25_Engg_N06	Nodal	JNV Karimnagar
EnableStudents_12_25_Engg_N07	Nodal	JNV Mandya
EnableStudents_12_25_Engg_N08	Nodal	JNV Nagpur
EnableStudents_12_25_Engg_N09	Nodal	JNV South Canara
EnableStudents_12_25_Engg_N10	Nodal	JNV Udupi
EnableStudents_12_25_Engg_N11	Nodal	JNV Wardha
EnableStudents_12_25_Med_C01	CoE	JNV Adilabad
EnableStudents_12_25_Med_C04	CoE	JNV Chandigarh
EnableStudents_12_25_Med_C07	CoE	JNV Hassan
EnableStudents_12_25_Med_C08	CoE	JNV Kohima
EnableStudents_12_25_Med_C09	CoE	JNV Kokrajhar
EnableStudents_12_25_Med_N01	Nodal	JNV Adilabad
EnableStudents_12_25_Med_N02	Nodal	JNV Bharuch
EnableStudents_12_25_Med_N03	Nodal	JNV Chamarajanagar
EnableStudents_12_25_Med_N04	Nodal	JNV Chandrapur
EnableStudents_12_25_Med_N05	Nodal	JNV Hassan
EnableStudents_12_25_Med_N06	Nodal	JNV Karimnagar
EnableStudents_12_25_Med_N07	Nodal	JNV Mandya
EnableStudents_12_25_Med_N08	Nodal	JNV Nagpur
EnableStudents_12_25_Med_N09	Nodal	JNV South Canara
EnableStudents_12_25_Med_N10	Nodal	JNV Udupi
EnableStudents_12_25_Med_N11	Nodal	JNV Wardha
EMRSStudents_11_Alpha_Eng_25_C001	CoE	EMRS Bhopal
EMRSStudents_12_Alpha_Eng_25_C001	CoE	EMRS Bhopal
EnableStudents_12_25_Engg_N12	Nodal	JNV Bhagalpur
EnableStudents_12_25_Med_N12	Nodal	JNV Bhagalpur
EnableStudents_11_25_Engg_N12	Nodal	JNV Bhagalpur
EnableStudents_11_25_Med_N12	Nodal	JNV Bhagalpur
EnableStudents_12_25_Engg_N13	Nodal	JNV Vaishali
EnableStudents_12_25_Med_N13	Nodal	JNV Vaishali
EnableStudents_11_25_Engg_N13	Nodal	JNV Vaishali
EnableStudents_11_25_Med_N13	Nodal	JNV Vaishali
EMRSStudents_11_Alpha_Med_25_C001	CoE	EMRS Bhopal
EMRSStudents_12_Alpha_Med_25_C001	CoE	EMRS Bhopal
""".strip()


def ensure_school_batch(cur, school_id: int, batch_id: int) -> bool:
    cur.execute(
        "SELECT 1 FROM school_batch WHERE school_id = %s AND batch_id = %s",
        (school_id, batch_id),
    )
    if cur.fetchone():
        return False
    cur.execute(
        """
        INSERT INTO school_batch (school_id, batch_id, inserted_at, updated_at)
        VALUES (%s, %s, NOW(), NOW())
        """,
        (school_id, batch_id),
    )
    return True


conn = psycopg2.connect(
    host=DB_HOST,
    port=DB_PORT,
    user=DB_USER,
    password=DB_PASSWORD,
    database=DB_NAME,
)

inserted = 0
skipped = 0
missing_batches = []
missing_schools = []

with conn:
    with conn.cursor() as cur:
        for raw_line in MAPPING_DATA.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            parts = [p.strip() for p in line.split("\t")]
            if len(parts) < 3:
                continue

            batch_key, _program, school_name = parts[0], parts[1], parts[2]

            cur.execute(
                "SELECT id, parent_id FROM batch WHERE batch_id = %s",
                (batch_key,),
            )
            batch_row = cur.fetchone()
            if not batch_row:
                missing_batches.append(batch_key)
                continue

            batch_id, parent_id = batch_row

            cur.execute("SELECT id FROM school WHERE name = %s", (school_name,))
            school_rows = cur.fetchall()
            if not school_rows:
                missing_schools.append(school_name)
                continue

            school_id = school_rows[0][0]

            if ensure_school_batch(cur, school_id, batch_id):
                inserted += 1
            else:
                skipped += 1

            if parent_id:
                if ensure_school_batch(cur, school_id, parent_id):
                    inserted += 1
                else:
                    skipped += 1

            # break

print(f"Inserted: {inserted}")
print(f"Skipped (already exists): {skipped}")
if missing_batches:
    print("Missing batch_id rows:", ", ".join(sorted(set(missing_batches))))
if missing_schools:
    print("Missing school rows:", ", ".join(sorted(set(missing_schools))))
