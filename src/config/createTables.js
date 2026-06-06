const pool = require('./database');

const createTables = async () => {
  try {
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      console.log('✅ Extension pgcrypto activée');
    } catch (extErr) {
      if (extErr.message.includes('permission denied')) {
        console.error('❌ Permission refusée pour créer l’extension pgcrypto.');
        console.error('   Exécutez cette commande avec un superutilisateur PostgreSQL :');
        console.error('   CREATE EXTENSION IF NOT EXISTS pgcrypto;');
      } else {
        console.error('❌ Erreur activation extension pgcrypto :', extErr.message);
      }
      process.exit(1);
    }

    // ── TABLE TENANTS (Associations) ──────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nom VARCHAR(150) NOT NULL,
        code_unique VARCHAR(20) UNIQUE NOT NULL,
        plan_abonnement VARCHAR(20) DEFAULT 'starter',
        actif BOOLEAN DEFAULT TRUE,
        logo_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table tenants créée');

    // ── TABLE MEMBERS (Membres) ───────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        nom_complet VARCHAR(200) NOT NULL,
        telephone VARCHAR(20) NOT NULL,
        role VARCHAR(30) DEFAULT 'membre',
        statut VARCHAR(20) DEFAULT 'actif',
        date_adhesion DATE DEFAULT CURRENT_DATE,
        score_fiabilite INTEGER DEFAULT 100,
        gav_solde DECIMAL(15,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tenant_id, telephone)
      );
    `);
    console.log('✅ Table members créée');

    // ── TABLE TONTINES ────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tontines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        nom VARCHAR(100) NOT NULL,
        montant_part DECIMAL(15,2) NOT NULL,
        periodicite VARCHAR(20) DEFAULT 'hebdo',
        nb_beneficiaires_seance INTEGER DEFAULT 1,
        mode_attribution VARCHAR(20) DEFAULT 'tour_role',
        parts_multiples BOOLEAN DEFAULT TRUE,
        penalite_absence DECIMAL(15,2) DEFAULT 0,
        regle_reliquat VARCHAR(20) DEFAULT 'reporter',
        statut VARCHAR(20) DEFAULT 'actif',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table tontines créée');

    // ── TABLE PRET_RUBRIQUES ──────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pret_rubriques (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        nom VARCHAR(100) NOT NULL,
        plafond DECIMAL(15,2),
        taux_interet DECIMAL(5,4) DEFAULT 0,
        periodicite_interet VARCHAR(20) DEFAULT 'mensuel',
        mode_calcul_interet VARCHAR(20) DEFAULT 'simple',
        duree_max_seances INTEGER DEFAULT 4,
        penalite_retard DECIMAL(5,4) DEFAULT 0,
        validation_requise VARCHAR(20) DEFAULT 'president',
        actif BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table pret_rubriques créée');

    // ── TABLE SEANCES ─────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS seances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        numero INTEGER NOT NULL,
        date_seance DATE DEFAULT CURRENT_DATE,
        statut VARCHAR(20) DEFAULT 'ouverte',
        caisse_theorique DECIMAL(15,2) DEFAULT 0,
        caisse_physique DECIMAL(15,2),
        ecart DECIMAL(15,2),
        justification_ecart TEXT,
        created_by UUID REFERENCES members(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table seances créée');

    // ── TABLE TRANSACTIONS (Journal Immuable) ─────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        seance_id UUID REFERENCES seances(id),
        member_id UUID REFERENCES members(id),
        type_transaction VARCHAR(30) NOT NULL,
        montant DECIMAL(15,2) NOT NULL,
        sens VARCHAR(10) NOT NULL,
        rubrique_id UUID,
        created_by UUID REFERENCES members(id),
        signature_hash VARCHAR(256),
        metadata_json JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table transactions créée');

    // ── TABLE OTP (Authentification) ──────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        telephone VARCHAR(20) NOT NULL,
        code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table otp_codes créée');

    console.log('\n🎉 Toutes les tables ont été créées avec succès !');
    process.exit(0);

  } catch (err) {
    console.error('❌ Erreur création tables :', err.message);
    process.exit(1);
  }
};

createTables();