# Bakery Orders (Tablette)

Application Next.js minimaliste pour saisir des commandes (pâtisserie / vente / boulanger), calculer le total, créer la commande dans Supabase et préparer l'étape suivante (fichier + envoi).

## Prérequis

- Node 18+
- Un projet Supabase (vous l'avez déjà) avec les tables `products`, `orders`, `order_items`, `missing_items`.

## Configuration

1. Copiez `.env.local.example` en `.env.local` et remplissez :
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```

2. Installez les dépendances :
   ```powershell
   npm install
   ```

3. Démarrez en local :
   ```powershell
   npm run dev
   ```
   Ouvrez http://localhost:3000

## Données de test (SQL)

Vous pouvez insérer quelques produits de test :

```sql
insert into public.products (name, price, category) values
('Tarte citron', 12.50, 'patiss'),
('Éclair chocolat', 3.20, 'patiss'),
('Mille-feuille', 3.80, 'patiss'),
('Eau 50cl', 1.20, 'vente'),
('Jus orange 1L', 2.90, 'vente'),
('Café moulu 250g', 4.50, 'vente'),
('Farine T55 25kg', 18.00, 'boulanger'),
('Levure fraîche 500g', 2.10, 'boulanger'),
('Sel 1kg', 0.90, 'boulanger')
on conflict do nothing;
```

## TODO (prochaines étapes)

- Générer un fichier CSV/PDF de la commande, uploader dans le bucket `orders`
- Envoyer le lien par SMS au commercial
- Écran “Historique des commandes” + marquer les produits manquants


## Nouvelles pages

- `/orders` : saisie des commandes (onglets par famille, cases à cocher + quantité 1–20).
- `/products` : gestion des produits (ajout / modification / suppression / actif).
- `/` redirige vers `/orders`.
