const pool = require('../config/database');
const PDFDocument = require('pdfkit');

const genererPV = async (req, res) => {
    const { seance_id } = req.params;
    const tenant_id = req.user.tenant_id;

    try {
        // ── DONNÉES ───────────────────────────────────────────────
        const seance = await pool.query(
            `SELECT s.*, p.nom_complet as president_seance_nom,
              m.nom_complet as ouvert_par_nom,
              t.nom as association_nom
       FROM seances s
       LEFT JOIN members p ON p.id = s.president_seance_id
       LEFT JOIN members m ON m.id = s.created_by
       LEFT JOIN tenants t ON t.id = s.tenant_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
            [seance_id, tenant_id]
        );

        if (seance.rows.length === 0) {
            return res.status(404).json({ message: 'Séance non trouvée' });
        }
        const s = seance.rows[0];

        const presences = await pool.query(
            `SELECT m.nom_complet,
              t.metadata_json->>'statut_presence' as statut
       FROM transactions t
       JOIN members m ON m.id = t.member_id
       WHERE t.seance_id = $1
       AND t.type_transaction = 'pointage'
       ORDER BY m.nom_complet ASC`,
            [seance_id]
        );

        const cotisations = await pool.query(
            `SELECT c.*, m.nom_complet, to2.nom as tontine_nom,
              to2.montant_part, mt.nb_parts,
              to2.seance_courante, to2.nb_seances_cycle
       FROM cotisations c
       JOIN members m ON m.id = c.member_id
       JOIN tontines to2 ON to2.id = c.tontine_id
       LEFT JOIN membre_tontine mt ON mt.member_id = c.member_id
         AND mt.tontine_id = c.tontine_id
       WHERE c.seance_id = $1
       ORDER BY to2.nom, m.nom_complet`,
            [seance_id]
        );

        const beneficiaires = await pool.query(
            `SELECT bt.*, m.nom_complet, to2.nom as tontine_nom,
              to2.nb_seances_cycle, to2.seance_courante
       FROM beneficiaires_tontine bt
       JOIN members m ON m.id = bt.member_id
       JOIN tontines to2 ON to2.id = bt.tontine_id
       WHERE bt.seance_id = $1
       ORDER BY bt.rang_beneficiaire`,
            [seance_id]
        );

        const epargnes = await pool.query(
            `SELECT t.montant, m.nom_complet, r.nom as rubrique_nom
       FROM transactions t
       JOIN members m ON m.id = t.member_id
       JOIN pret_rubriques r ON r.id = t.rubrique_id
       WHERE t.seance_id = $1 AND t.type_transaction = 'epargne'
       ORDER BY r.nom, m.nom_complet`,
            [seance_id]
        );

        const prets = await pool.query(
            `SELECT t.montant, m.nom_complet, r.nom as rubrique_nom
       FROM transactions t
       JOIN members m ON m.id = t.member_id
       JOIN pret_rubriques r ON r.id = t.rubrique_id
       WHERE t.seance_id = $1 AND t.type_transaction = 'pret'
       ORDER BY r.nom, m.nom_complet`,
            [seance_id]
        );

        const remboursements = await pool.query(
            `SELECT t.montant, m.nom_complet, r.nom as rubrique_nom
       FROM transactions t
       JOIN members m ON m.id = t.member_id
       JOIN pret_rubriques r ON r.id = t.rubrique_id
       WHERE t.seance_id = $1 AND t.type_transaction = 'remboursement'
       ORDER BY r.nom, m.nom_complet`,
            [seance_id]
        );

        const gav = await pool.query(
            `SELECT t.type_transaction, t.montant, m.nom_complet
       FROM transactions t
       JOIN members m ON m.id = t.member_id
       WHERE t.seance_id = $1
       AND t.type_transaction IN ('gav_depot','gav_retrait')
       ORDER BY t.type_transaction, m.nom_complet`,
            [seance_id]
        );

        const nouvelles = await pool.query(
            `SELECT * FROM nouvelles_familiales
       WHERE seance_id = $1 ORDER BY created_at ASC`,
            [seance_id]
        ).catch(() => ({ rows: [] }));

        const ordreJour = await pool.query(
            `SELECT * FROM ordre_du_jour
       WHERE seance_id = $1 ORDER BY ordre ASC`,
            [seance_id]
        ).catch(() => ({ rows: [] }));

        const divers = await pool.query(
            `SELECT d.*, m.nom_complet as auteur_nom
       FROM divers_seance d
       LEFT JOIN members m ON m.id = d.auteur_id
       WHERE d.seance_id = $1 ORDER BY d.created_at ASC`,
            [seance_id]
        ).catch(() => ({ rows: [] }));

        // ── SETUP PDF ─────────────────────────────────────────────
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 40, bottom: 40, left: 40, right: 40 },
            info: {
                Title: `PV Séance #${s.numero}`,
                Author: 'Digi-Réunion'
            }
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition',
            `attachment; filename="PV_Seance_${s.numero}.pdf"`);
        doc.pipe(res);

        // ── COULEURS ──────────────────────────────────────────────
        const BLEU = '#1B4F72';
        const VERT = '#1A8A6F';
        const GRIS = '#F2F3F4';
        const NOIR = '#1C2833';
        const ROUGE = '#C0392B';
        const BLEU2 = '#D6EAF8';
        const VERT2 = '#D5F5E3';

        const L = 40;   // left margin
        const R = 555;  // right margin
        const W = R - L; // usable width

        // ── HELPERS ───────────────────────────────────────────────

        // Vérifier saut de page
        const checkPage = (needed = 30) => {
            if (doc.y + needed > 780) {
                doc.addPage();
                doc.y = 40;
            }
        };

        // Titre de section
        const section = (titre, color = BLEU) => {
            checkPage(30);
            const y = doc.y;
            doc.rect(L, y, W, 18).fill(color);
            doc.fillColor('white').fontSize(9.5)
                .font('Helvetica-Bold')
                .text(titre, L + 5, y + 4, { width: W - 10, lineBreak: false });
            doc.y = y + 22;
            doc.fillColor(NOIR);
        };

        // Ligne simple de texte
        const ligne = (texte, opts = {}) => {
            checkPage(14);
            const x = opts.x || L + (opts.indent || 0);
            const color = opts.color || NOIR;
            const font = opts.bold ? 'Helvetica-Bold' : 'Helvetica';
            const size = opts.size || 8.5;
            doc.fillColor(color).fontSize(size).font(font)
                .text(texte, x, doc.y,
                    {
                        width: opts.width || W - (opts.indent || 0),
                        lineBreak: false
                    });
            doc.y += opts.h || 13;
        };

        // Ligne de tableau à 2 colonnes
        const row2 = (col1, col2, opts = {}) => {
            checkPage(14);
            const y = doc.y;
            const w1 = opts.w1 || W * 0.6;
            const w2 = W - w1;
            const bg = opts.bg;
            const hh = opts.h || 14;

            if (bg) doc.rect(L, y, W, hh).fill(bg);

            const fc = opts.header ? 'white' : NOIR;
            const font = opts.header ? 'Helvetica-Bold' : 'Helvetica';

            doc.fillColor(fc).fontSize(8.5).font(font)
                .text(String(col1 || ''), L + 3, y + 2,
                    { width: w1 - 6, lineBreak: false })
                .text(String(col2 || ''), L + w1 + 3, y + 2,
                    { width: w2 - 6, lineBreak: false });

            doc.y = y + hh;
            doc.fillColor(NOIR);
        };

        // Ligne de tableau à N colonnes
        const rowN = (cols, widths, opts = {}) => {
            checkPage(14);
            const y = doc.y;
            const hh = opts.h || 14;
            const bg = opts.bg;

            if (bg) doc.rect(L, y, W, hh).fill(bg);

            const fc = opts.header ? 'white' : NOIR;
            const font = opts.header ? 'Helvetica-Bold' : 'Helvetica';
            doc.fillColor(fc).fontSize(8.5).font(font);

            let x = L;
            cols.forEach((col, i) => {
                doc.text(String(col || ''), x + 3, y + 2,
                    { width: widths[i] - 6, lineBreak: false });
                x += widths[i];
            });

            doc.y = y + hh;
            doc.fillColor(NOIR);
        };

        const espacer = (h = 6) => { doc.y += h; };

        // ── EN-TÊTE ───────────────────────────────────────────────
        doc.rect(L, 40, W, 45).fill(BLEU);
        doc.fillColor('white').fontSize(15).font('Helvetica-Bold')
            .text(s.association_nom.toUpperCase(), L, 50,
                { width: W, align: 'center', lineBreak: false });
        doc.fontSize(9).font('Helvetica')
            .text('PROCÈS-VERBAL DE SÉANCE', L, 68,
                { width: W, align: 'center', lineBreak: false });
        doc.y = 95;

        // Bandeau infos séance
        doc.rect(L, doc.y, W, 52).fill(GRIS);
        const iy = doc.y + 6;
        const dateSeance = new Date(s.date_seance)
            .toLocaleDateString('fr-FR', {
                weekday: 'long', year: 'numeric',
                month: 'long', day: 'numeric'
            });

        doc.fillColor(NOIR).fontSize(9).font('Helvetica-Bold')
            .text(`Séance N° ${s.numero}`, L + 5, iy,
                { lineBreak: false });
        doc.font('Helvetica')
            .text(`Date : ${dateSeance}`, L + 5, iy + 13,
                { lineBreak: false });
        doc.text(`Président de séance : ${s.president_seance_nom || '—'}`,
            L + 5, iy + 26, { lineBreak: false });
        doc.text(`Secrétaire : ${s.ouvert_par_nom || '—'}`,
            L + W / 2, iy + 13, { lineBreak: false });
        doc.text(`Statut : ${s.statut === 'close' ? 'Clôturée' : 'En cours'}`,
            L + W / 2, iy + 26, { lineBreak: false });

        doc.y = 155;
        espacer(8);

        // ── 1. ORDRE DU JOUR ──────────────────────────────────────
        section('1. ORDRE DU JOUR');
        espacer(2);

        const pointsODJ = ordreJour.rows.length > 0
            ? ordreJour.rows.map(p => p.point)
            : ['Nouvelles familiales', 'Rappel de la dernière séance',
                'Finances', 'Divers'];

        pointsODJ.forEach((pt, i) => {
            ligne(`${i + 1}. ${pt}`, { indent: 8 });
        });
        espacer(8);

        // ── 2. PRÉSENCES ──────────────────────────────────────────
        section('2. PRÉSENCES');
        espacer(2);

        const presents = presences.rows.filter(p => p.statut === 'present');
        const absents = presences.rows.filter(p => p.statut === 'absent');
        const excuses = presences.rows.filter(p => p.statut === 'excuse');

        ligne(
            `Présents : ${presents.length}  |  ` +
            `Absents : ${absents.length}  |  ` +
            `Excusés : ${excuses.length}  |  ` +
            `Total : ${presences.rows.length}`,
            { indent: 8, bold: true }
        );

        if (absents.length > 0) {
            espacer(2);
            checkPage(14);
            doc.fillColor(ROUGE).fontSize(8.5).font('Helvetica-Bold')
                .text('Absents : ', L + 8, doc.y, { continued: true, lineBreak: false });
            doc.fillColor(NOIR).font('Helvetica')
                .text(absents.map(a => a.nom_complet).join(', '),
                    { lineBreak: false });
            doc.y += 13;
        }

        if (excuses.length > 0) {
            espacer(2);
            checkPage(14);
            doc.fillColor('#E67E22').fontSize(8.5).font('Helvetica-Bold')
                .text('Excusés : ', L + 8, doc.y, { continued: true, lineBreak: false });
            doc.fillColor(NOIR).font('Helvetica')
                .text(excuses.map(e => e.nom_complet).join(', '),
                    { lineBreak: false });
            doc.y += 13;
        }
        espacer(8);

        // ── 3. NOUVELLES FAMILIALES ───────────────────────────────
        if (nouvelles.rows.length > 0) {
            section('3. NOUVELLES FAMILIALES', VERT);
            espacer(2);
            nouvelles.rows.forEach(n => {
                ligne(`• ${n.membre_nom} : ${n.description}`, { indent: 8 });
            });
            espacer(8);
        }

        // ── 4. FINANCES ───────────────────────────────────────────
        section('4. FINANCES', BLEU);
        espacer(4);

        // 4.1 Cotisations par tontine
        const tontinesUniques = [...new Set(
            cotisations.rows.map(c => c.tontine_nom)
        )];

        tontinesUniques.forEach(nomTontine => {
            const cotsTontine = cotisations.rows
                .filter(c => c.tontine_nom === nomTontine);
            const totalCots = cotsTontine
                .filter(c => c.statut === 'cotise')
                .reduce((s, c) => s + parseFloat(c.montant_total), 0);
            const nbCotises = cotsTontine
                .filter(c => c.statut === 'cotise').length;

            // Info cycle tontine
            const tontineInfo = cotsTontine[0];
            const cycleInfo = tontineInfo
                ? `${tontineInfo.seance_courante || '?'}e séance sur ${tontineInfo.nb_seances_cycle || 52}`
                : '';

            checkPage(20);
            const sy = doc.y;
            doc.rect(L, sy, W, 16).fill(BLEU2);
            doc.fillColor(BLEU).fontSize(9).font('Helvetica-Bold')
                .text(
                    `${nomTontine} — ${cycleInfo} — ` +
                    `Total : ${totalCots.toLocaleString('fr-FR')} FCFA` +
                    ` (${nbCotises} cotisant(s))`,
                    L + 5, sy + 3,
                    { width: W - 10, lineBreak: false }
                );
            doc.y = sy + 20;
            doc.fillColor(NOIR);

            // Bénéficiaires de cette tontine
            const benefsTontine = beneficiaires.rows
                .filter(b => b.tontine_nom === nomTontine);

            benefsTontine.forEach(b => {
                const deductions = b.deductions_json?.deductions || [];
                const pretsB = b.deductions_json?.prets || [];

                espacer(2);
                checkPage(20);
                ligne(
                    `${b.rang_beneficiaire}e bénéficiaire : ${b.nom_complet}`,
                    { indent: 8, bold: true }
                );
                ligne(
                    `Montant bénéficié : ${parseFloat(b.montant_brut)
                        .toLocaleString('fr-FR')} FCFA`,
                    { indent: 12 }
                );
                espacer(2);

                // Tableau déductions
                const w1 = W * 0.65;
                const w2 = W * 0.35;
                rowN(
                    ['Intitulé et montant débité', 'Net perçu'],
                    [w1, w2],
                    { header: true, bg: BLEU }
                );

                let totalDed = 0;
                let bg = false;

                deductions.forEach(d => {
                    totalDed += parseFloat(d.montant || 0);
                    rowN(
                        [`  ${d.nom} : ${parseFloat(d.montant)
                            .toLocaleString('fr-FR')} F`, ''],
                        [w1, w2],
                        { bg: bg ? GRIS : null }
                    );
                    bg = !bg;
                });

                pretsB.forEach(p => {
                    totalDed += parseFloat(p.montant_deduit || 0);
                    rowN(
                        [`  Prêt ${p.rubrique_nom} : ${parseFloat(p.montant_deduit)
                            .toLocaleString('fr-FR')} F`, ''],
                        [w1, w2],
                        { bg: bg ? GRIS : null }
                    );
                    bg = !bg;
                });

                rowN(
                    [
                        `  Total déductions : ${totalDed.toLocaleString('fr-FR')} F`,
                        `${parseFloat(b.montant_net).toLocaleString('fr-FR')} FCFA`
                    ],
                    [w1, w2],
                    { bg: VERT2, header: true }
                );
                espacer(4);
            });

            // Non cotisés
            const nonCotises = cotsTontine
                .filter(c => c.statut === 'non_cotise');
            if (nonCotises.length > 0) {
                espacer(2);
                checkPage(14);
                doc.fillColor(ROUGE).fontSize(8.5).font('Helvetica-Bold')
                    .text('Non cotisés : ', L + 8, doc.y,
                        { continued: true, lineBreak: false });
                doc.fillColor(NOIR).font('Helvetica')
                    .text(nonCotises.map(c => c.nom_complet).join(', '),
                        { lineBreak: false });
                doc.y += 13;
            }
            espacer(6);
        });

        // 4.2 Épargnes
        if (epargnes.rows.length > 0) {
            const epargnesParRubrique = {};
            epargnes.rows.forEach(e => {
                if (!epargnesParRubrique[e.rubrique_nom])
                    epargnesParRubrique[e.rubrique_nom] = [];
                epargnesParRubrique[e.rubrique_nom].push(e);
            });

            Object.entries(epargnesParRubrique).forEach(([rubrique, items]) => {
                const total = items.reduce(
                    (s, e) => s + parseFloat(e.montant), 0);
                checkPage(20);
                const sy = doc.y;
                doc.rect(L, sy, W, 16).fill(BLEU2);
                doc.fillColor(BLEU).fontSize(9).font('Helvetica-Bold')
                    .text(
                        `${rubrique} — Total cotisé : ${total
                            .toLocaleString('fr-FR')} FCFA`,
                        L + 5, sy + 3, { width: W - 10, lineBreak: false }
                    );
                doc.y = sy + 20;
                doc.fillColor(NOIR);

                items.forEach(e => {
                    ligne(
                        `• ${e.nom_complet} : ${parseFloat(e.montant)
                            .toLocaleString('fr-FR')} FCFA`,
                        { indent: 8 }
                    );
                });
                espacer(4);
            });
        }

        // 4.3 GAV
        const gavDepots = gav.rows.filter(g =>
            g.type_transaction === 'gav_depot');
        const gavRetraits = gav.rows.filter(g =>
            g.type_transaction === 'gav_retrait');

        if (gavDepots.length > 0) {
            const total = gavDepots.reduce(
                (s, g) => s + parseFloat(g.montant), 0);
            checkPage(20);
            const sy = doc.y;
            doc.rect(L, sy, W, 16).fill(BLEU2);
            doc.fillColor(BLEU).fontSize(9).font('Helvetica-Bold')
                .text(`Dépôts Garde à Vue — Total : ${total
                    .toLocaleString('fr-FR')} FCFA`,
                    L + 5, sy + 3, { width: W - 10, lineBreak: false });
            doc.y = sy + 20;
            doc.fillColor(NOIR);
            gavDepots.forEach(g => {
                ligne(`• ${g.nom_complet} : ${parseFloat(g.montant)
                    .toLocaleString('fr-FR')} FCFA`, { indent: 8 });
            });
            espacer(4);
        }

        if (gavRetraits.length > 0) {
            const total = gavRetraits.reduce(
                (s, g) => s + parseFloat(g.montant), 0);
            checkPage(20);
            const sy = doc.y;
            doc.rect(L, sy, W, 16).fill(BLEU2);
            doc.fillColor(BLEU).fontSize(9).font('Helvetica-Bold')
                .text(`Retraits Garde à Vue — Total : ${total
                    .toLocaleString('fr-FR')} FCFA`,
                    L + 5, sy + 3, { width: W - 10, lineBreak: false });
            doc.y = sy + 20;
            doc.fillColor(NOIR);
            gavRetraits.forEach(g => {
                ligne(`• ${g.nom_complet} : ${parseFloat(g.montant)
                    .toLocaleString('fr-FR')} FCFA`, { indent: 8 });
            });
            espacer(4);
        }

        // 4.4 Prêts accordés
        if (prets.rows.length > 0) {
            const pretsParRubrique = {};
            prets.rows.forEach(p => {
                if (!pretsParRubrique[p.rubrique_nom])
                    pretsParRubrique[p.rubrique_nom] = [];
                pretsParRubrique[p.rubrique_nom].push(p);
            });

            Object.entries(pretsParRubrique).forEach(([rubrique, items]) => {
                const total = items.reduce(
                    (s, p) => s + parseFloat(p.montant), 0);
                checkPage(20);
                const sy = doc.y;
                doc.rect(L, sy, W, 16).fill(BLEU2);
                doc.fillColor(BLEU).fontSize(9).font('Helvetica-Bold')
                    .text(`Prêts ${rubrique} — Total : ${total
                        .toLocaleString('fr-FR')} FCFA`,
                        L + 5, sy + 3, { width: W - 10, lineBreak: false });
                doc.y = sy + 20;
                doc.fillColor(NOIR);
                items.forEach(p => {
                    ligne(`• ${p.nom_complet} : ${parseFloat(p.montant)
                        .toLocaleString('fr-FR')} FCFA`, { indent: 8 });
                });
                espacer(4);
            });
        }

        // 4.5 Remboursements
        if (remboursements.rows.length > 0) {
            const total = remboursements.rows.reduce(
                (s, r) => s + parseFloat(r.montant), 0);
            checkPage(20);
            const sy = doc.y;
            doc.rect(L, sy, W, 16).fill(BLEU2);
            doc.fillColor(BLEU).fontSize(9).font('Helvetica-Bold')
                .text(`Remboursements — Total : ${total
                    .toLocaleString('fr-FR')} FCFA`,
                    L + 5, sy + 3, { width: W - 10, lineBreak: false });
            doc.y = sy + 20;
            doc.fillColor(NOIR);
            remboursements.rows.forEach(r => {
                ligne(
                    `• ${r.nom_complet} (${r.rubrique_nom}) : ` +
                    `${parseFloat(r.montant).toLocaleString('fr-FR')} FCFA`,
                    { indent: 8 }
                );
            });
            espacer(8);
        }

        // ── 5. RÉCAPITULATIF ──────────────────────────────────────
        checkPage(120);
        section('5. RÉCAPITULATIF FINANCIER', BLEU);
        espacer(4);

        // Calculer entrées/sorties
        const lignesE = [];
        const lignesS = [];

        tontinesUniques.forEach(nom => {
            const total = cotisations.rows
                .filter(c => c.tontine_nom === nom && c.statut === 'cotise')
                .reduce((s, c) => s + parseFloat(c.montant_total), 0);
            if (total > 0)
                lignesE.push(`${nom} : ${total.toLocaleString('fr-FR')} F`);
        });

        if (epargnes.rows.length > 0) {
            const total = epargnes.rows.reduce(
                (s, e) => s + parseFloat(e.montant), 0);
            lignesE.push(`Épargne : ${total.toLocaleString('fr-FR')} F`);
        }

        if (remboursements.rows.length > 0) {
            const total = remboursements.rows.reduce(
                (s, r) => s + parseFloat(r.montant), 0);
            lignesE.push(
                `Intérêts/Remboursements : ${total.toLocaleString('fr-FR')} F`
            );
        }

        if (gavDepots.length > 0) {
            const total = gavDepots.reduce(
                (s, g) => s + parseFloat(g.montant), 0);
            lignesE.push(`Garde à Vue : ${total.toLocaleString('fr-FR')} F`);
        }

        beneficiaires.rows.forEach(b => {
            lignesS.push(
                `Bénéfice ${b.nom_complet} : ` +
                `${parseFloat(b.montant_net).toLocaleString('fr-FR')} F`
            );
        });

        if (prets.rows.length > 0) {
            const total = prets.rows.reduce(
                (s, p) => s + parseFloat(p.montant), 0);
            lignesS.push(
                `Prêts accordés : ${total.toLocaleString('fr-FR')} F`
            );
        }

        if (gavRetraits.length > 0) {
            const total = gavRetraits.reduce(
                (s, g) => s + parseFloat(g.montant), 0);
            lignesS.push(
                `Retraits GAV : ${total.toLocaleString('fr-FR')} F`
            );
        }

        const w1 = W / 2;
        const w2 = W / 2;

        // En-tête tableau récap
        rowN(['ENTRÉES', 'SORTIES'], [w1, w2],
            { header: true, bg: BLEU });

        // Lignes entrées/sorties côte à côte
        const maxL = Math.max(lignesE.length, lignesS.length);
        for (let i = 0; i < maxL; i++) {
            rowN(
                [lignesE[i] || '', lignesS[i] || ''],
                [w1, w2],
                { bg: i % 2 === 0 ? GRIS : null }
            );
        }

        // Totaux
        const totalE = cotisations.rows
            .filter(c => c.statut === 'cotise')
            .reduce((s, c) => s + parseFloat(c.montant_total), 0)
            + epargnes.rows.reduce((s, e) => s + parseFloat(e.montant), 0)
            + remboursements.rows.reduce((s, r) => s + parseFloat(r.montant), 0)
            + gavDepots.reduce((s, g) => s + parseFloat(g.montant), 0);

        const totalS = beneficiaires.rows
            .reduce((s, b) => s + parseFloat(b.montant_net), 0)
            + prets.rows.reduce((s, p) => s + parseFloat(p.montant), 0)
            + gavRetraits.reduce((s, g) => s + parseFloat(g.montant), 0);

        rowN(
            [
                `Total des entrées : ${totalE.toLocaleString('fr-FR')} F`,
                `Total des sorties : ${totalS.toLocaleString('fr-FR')} F`
            ],
            [w1, w2],
            { header: true, bg: VERT2 }
        );

        // Différence
        const diff = totalE - totalS;
        checkPage(20);
        const dy = doc.y;
        doc.rect(L, dy, W, 18).fill(diff >= 0 ? VERT : ROUGE);
        doc.fillColor('white').fontSize(9.5).font('Helvetica-Bold')
            .text(
                `Différence : ${totalE.toLocaleString('fr-FR')} - ` +
                `${totalS.toLocaleString('fr-FR')} = ` +
                `${diff.toLocaleString('fr-FR')} FCFA`,
                L, dy + 4,
                { width: W, align: 'center', lineBreak: false }
            );
        doc.y = dy + 22;
        espacer(4);

        // Caisse
        if (s.caisse_theorique) {
            ligne(
                `Caisse théorique : ${parseFloat(s.caisse_theorique)
                    .toLocaleString('fr-FR')} FCFA`,
                { indent: 8, bold: true }
            );
        }
        if (s.caisse_physique) {
            ligne(
                `Caisse physique : ${parseFloat(s.caisse_physique)
                    .toLocaleString('fr-FR')} FCFA`,
                { indent: 8, bold: true }
            );
            const ecart = parseFloat(s.ecart || 0);
            ligne(
                `Écart : ${ecart.toLocaleString('fr-FR')} FCFA` +
                (ecart === 0 ? ' ✓ Parfaite' : ' ⚠ Écart détecté'),
                {
                    indent: 8, bold: true,
                    color: ecart === 0 ? VERT : ROUGE
                }
            );
        }
        espacer(10);

        // ── 6. DIVERS ─────────────────────────────────────────────
        if (divers.rows.length > 0) {
            section('6. DIVERS', BLEU);
            espacer(2);
            divers.rows.forEach(d => {
                const auteur = d.auteur_nom ? `${d.auteur_nom} : ` : '';
                ligne(`• ${auteur}${d.contenu}`, { indent: 8 });
            });
            espacer(8);
        }

        // ── 7. SIGNATURES ─────────────────────────────────────────
        checkPage(70);
        section('7. SIGNATURES', BLEU);
        espacer(10);

        const sigY = doc.y;
        const col1 = L;
        const col2 = L + W / 3;
        const col3 = L + (W / 3) * 2;
        const cw = W / 3;

        doc.fillColor(NOIR).fontSize(8.5).font('Helvetica-Bold');
        doc.text('Le Secrétaire', col1, sigY,
            { width: cw, align: 'center', lineBreak: false });
        doc.text('Le Président de séance', col2, sigY,
            { width: cw, align: 'center', lineBreak: false });
        doc.text('Le Président', col3, sigY,
            { width: cw, align: 'center', lineBreak: false });

        // Lignes de signature
        [col1, col2, col3].forEach(x => {
            doc.moveTo(x + 10, sigY + 35)
                .lineTo(x + cw - 10, sigY + 35)
                .strokeColor('#AAAAAA').lineWidth(0.5).stroke();
        });

        doc.fillColor('#666666').fontSize(7.5).font('Helvetica');
        doc.text(s.ouvert_par_nom || '___________',
            col1, sigY + 40, { width: cw, align: 'center', lineBreak: false });
        doc.text(s.president_seance_nom || '___________',
            col2, sigY + 40, { width: cw, align: 'center', lineBreak: false });

        // ── PIED DE PAGE ──────────────────────────────────────────
        const pH = doc.page.height - 20;
        doc.fillColor('#AAAAAA').fontSize(7).font('Helvetica')
            .text(
                `Généré par Digi-Réunion · ${new Date()
                    .toLocaleString('fr-FR')}`,
                L, pH,
                { width: W, align: 'center', lineBreak: false }
            );

        doc.end();

    } catch (err) {
        console.error('Erreur genererPV :', err.message);
        console.error(err.stack);
        if (!res.headersSent) {
            res.status(500).json({ message: 'Erreur génération PV' });
        }
    }
};

module.exports = { genererPV };
