// src/config/migrate.js
const pool = require('./database');

const migrate = async () => {
  console.log('🔄 Migration en cours...');

  try {
    // Créer toutes les tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nom VARCHAR(150) NOT NULL,
        code_unique VARCHAR(20) UNIQUE NOT NULL,
        plan_abonnement VARCHAR(20) DEFAULT 'starter',
        actif BOOLEAN DEFAULT TRUE,
        logo_url TEXT,
        description TEXT,
        lieu_reunion VARCHAR(200),
        periodicite_seance VARCHAR(20) DEFAULT 'hebdo',
        telephone VARCHAR(20),
        email VARCHAR(100),
        date_creation_asso DATE,
        roles_actifs JSONB DEFAULT '{"vice_president":true,"tresorier":true,"censeur":true}',
        updated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table tenants');

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
    console.log('✅ Table members');

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
        nb_seances_cycle INTEGER DEFAULT 52,
        seance_courante INTEGER DEFAULT 0,
        duree_cycle INTEGER DEFAULT 52,
        unite_cycle VARCHAR(20) DEFAULT 'semaines',
        date_debut DATE DEFAULT CURRENT_DATE,
        date_fin DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table tontines');

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
        type_rubrique VARCHAR(20) DEFAULT 'pret',
        est_obligatoire BOOLEAN DEFAULT FALSE,
        montant_minimum DECIMAL(15,2) DEFAULT 0,
        montant_fixe DECIMAL(15,2),
        interet_epargne DECIMAL(5,4) DEFAULT 0,
        frequence_remboursement VARCHAR(20) DEFAULT 'seance',
        nb_echeances INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table pret_rubriques');

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
        president_seance_id UUID REFERENCES members(id),
        notes_ouverture TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table seances');

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
    console.log('✅ Table transactions');

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
    console.log('✅ Table otp_codes');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS membre_tontine (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        member_id UUID REFERENCES members(id) ON DELETE CASCADE,
        tontine_id UUID REFERENCES tontines(id) ON DELETE CASCADE,
        nb_parts INTEGER DEFAULT 1,
        date_inscription DATE DEFAULT CURRENT_DATE,
        statut VARCHAR(20) DEFAULT 'actif',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(member_id, tontine_id)
      );
    `);
    console.log('✅ Table membre_tontine');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cotisations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        seance_id UUID REFERENCES seances(id) ON DELETE CASCADE,
        member_id UUID REFERENCES members(id) ON DELETE CASCADE,
        tontine_id UUID REFERENCES tontines(id) ON DELETE CASCADE,
        nb_parts_cotisees INTEGER DEFAULT 1,
        montant_total DECIMAL(15,2) NOT NULL,
        statut VARCHAR(20) DEFAULT 'cotise',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table cotisations');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS epargne_membres (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        member_id UUID REFERENCES members(id) ON DELETE CASCADE,
        rubrique_id UUID REFERENCES pret_rubriques(id) ON DELETE CASCADE,
        solde DECIMAL(15,2) DEFAULT 0,
        total_cotise DECIMAL(15,2) DEFAULT 0,
        statut VARCHAR(20) DEFAULT 'en_cours',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(member_id, rubrique_id)
      );
    `);
    console.log('✅ Table epargne_membres');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS prets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        member_id UUID REFERENCES members(id) ON DELETE CASCADE,
        rubrique_id UUID REFERENCES pret_rubriques(id) ON DELETE CASCADE,
        montant DECIMAL(15,2) NOT NULL,
        taux_interet DECIMAL(5,4) DEFAULT 0,
        montant_interet DECIMAL(15,2) DEFAULT 0,
        montant_total_du DECIMAL(15,2) NOT NULL,
        montant_rembourse DECIMAL(15,2) DEFAULT 0,
        nb_echeances INTEGER DEFAULT 1,
        frequence_remboursement VARCHAR(20) DEFAULT 'seance',
        statut VARCHAR(20) DEFAULT 'en_attente',
        date_demande TIMESTAMP DEFAULT NOW(),
        date_approbation TIMESTAMP,
        approuve_par UUID REFERENCES members(id),
        seance_id UUID REFERENCES seances(id),
        metadata_json JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table prets');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS remboursements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        pret_id UUID REFERENCES prets(id) ON DELETE CASCADE,
        member_id UUID REFERENCES members(id) ON DELETE CASCADE,
        seance_id UUID REFERENCES seances(id),
        montant_capital DECIMAL(15,2) NOT NULL,
        montant_interet DECIMAL(15,2) DEFAULT 0,
        montant_total DECIMAL(15,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table remboursements');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rubriques_deduction (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        nom VARCHAR(100) NOT NULL,
        type_montant VARCHAR(20) DEFAULT 'fixe',
        montant DECIMAL(15,2) DEFAULT 0,
        pourcentage DECIMAL(5,4) DEFAULT 0,
        applicable_a VARCHAR(20) DEFAULT 'toutes',
        actif BOOLEAN DEFAULT TRUE,
        ordre INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table rubriques_deduction');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS beneficiaires_tontine (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        tontine_id UUID REFERENCES tontines(id) ON DELETE CASCADE,
        seance_id UUID REFERENCES seances(id) ON DELETE CASCADE,
        member_id UUID REFERENCES members(id) ON DELETE CASCADE,
        rang_beneficiaire INTEGER NOT NULL,
        montant_brut DECIMAL(15,2) NOT NULL,
        montant_deductions DECIMAL(15,2) DEFAULT 0,
        montant_net DECIMAL(15,2) NOT NULL,
        deductions_json JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table beneficiaires_tontine');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS nouvelles_familiales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        seance_id UUID REFERENCES seances(id) ON DELETE CASCADE,
        member_id UUID REFERENCES members(id),
        membre_nom VARCHAR(200) NOT NULL,
        type_nouvelle VARCHAR(30) DEFAULT 'autre',
        description TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table nouvelles_familiales');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ordre_du_jour (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        seance_id UUID REFERENCES seances(id) ON DELETE CASCADE,
        point TEXT NOT NULL,
        ordre INTEGER DEFAULT 1,
        statut VARCHAR(20) DEFAULT 'en_attente',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table ordre_du_jour');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS divers_seance (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        seance_id UUID REFERENCES seances(id) ON DELETE CASCADE,
        contenu TEXT NOT NULL,
        auteur_id UUID REFERENCES members(id),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Table divers_seance');

    console.log('\n🎉 Migration terminée avec succès !');
    process.exit(0);

  } catch (err) {
    console.error('❌ Erreur migration :', err.message);
    process.exit(1);
  }
};

migrate();