import { BlockManager } from '../src/sync/BlockManager';
import { NotesheetStore } from '../src/storage/NotesheetStore';
import { createDefaultNotesheetData } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

console.log('=== RUNNING NOTESHEET PLUGIN TESTS ===\n');

// Mock App
const mockApp = {
  vault: {
    getAbstractFileByPath: () => null,
    getFiles: () => [],
    read: async () => '',
    modify: async () => {},
    create: async () => {}
  },
  metadataCache: {
    getFileCache: () => null
  }
};

const bm = new BlockManager(mockApp);
const store = new NotesheetStore(mockApp);

// Test 1: Block ID generation
console.log('Test Suite 1: Block ID generation');
const id1 = bm.generateBlockId();
const id2 = bm.generateBlockId();
assert(id1.startsWith('ns-') && id1.length === 9, `Valid ID format: ${id1}`);
assert(id1 !== id2, 'Generated unique IDs');

// Test 2: Title inference
console.log('\nTest Suite 2: Title Inference');
assert(bm.inferTitle('# Euler Equation\n$e^{i\\pi}+1=0$') === 'Euler Equation', 'Infer from heading');
assert(bm.inferTitle('**Ohm\'s Law:** $V = IR$') === 'Ohm\'s Law', 'Infer from bold prefix');
assert(bm.inferTitle('> [!tip] Integration by Parts\n> $\\int u dv = uv - \\int v du$') === 'Integration by Parts', 'Infer from callout');
assert(bm.inferTitle(':luc_layers: **Upcasting and Slicing** \n- some list') === 'Upcasting and Slicing', 'Strip icon shortcode and bold');
assert(bm.inferTitle(':luc_mouse_pointer: **LValues and RValues**\n- text') === 'LValues and RValues', 'Strip mouse pointer shortcode and bold');

// Test 3: Block content extraction
console.log('\nTest Suite 3: Block Content Finding');
const sampleMarkdown = `# Physics 240 Formulas

Newton's second law is $F = ma$. ^ns-newton2

Here is Ampere's law:
$$
\\oint \\vec{B} \\cdot d\\vec{l} = \\mu_0 I_{\\text{enc}}
$$ ^ns-ampere

> [!important]
> Work-Energy Theorem:
> $W_{\\text{net}} = \\Delta K$
^ns-workenergy

- First bullet
- Second bullet item ^ns-bullet
`;

const newtonContent = bm.findBlockContent(sampleMarkdown, 'ns-newton2');
assert(newtonContent === "Newton's second law is $F = ma$.", `Extracted single line: "${newtonContent}"`);

const ampereContent = bm.findBlockContent(sampleMarkdown, 'ns-ampere');
assert(ampereContent.includes('\\oint \\vec{B}'), `Extracted math block:\n${ampereContent}`);

const workContent = bm.findBlockContent(sampleMarkdown, 'ns-workenergy');
assert(workContent.includes('Work-Energy Theorem'), `Extracted callout:\n${workContent}`);

const bulletContent = bm.findBlockContent(sampleMarkdown, 'ns-bullet');
assert(bulletContent.includes('Second bullet item'), `Extracted bullet: ${bulletContent}`);

// Test 4: Block content updating (Two-way sync simulation)
console.log('\nTest Suite 4: Block Updating (Syncing back to note)');
const updatedNewton = "Newton's second law in relativistic form is $F = \\frac{dp}{dt}$.";
const updatedDoc = bm.updateBlockInContent(sampleMarkdown, 'ns-newton2', updatedNewton);

assert(updatedDoc.includes(updatedNewton), 'Note content contains new text');
assert(updatedDoc.includes('^ns-newton2'), 'Note content preserves anchor ^ns-newton2');
assert(updatedDoc.includes('^ns-ampere'), 'Other blocks remain untouched');

const reRead = bm.findBlockContent(updatedDoc, 'ns-newton2');
assert(reRead === updatedNewton, `Re-extracted updated block matches perfectly: "${reRead}"`);

// Test 5: Default Notesheet Data format (2 pages: Front and Back)
console.log('\nTest Suite 5: Store Serialization & 2-Page Default');
const defaultData = createDefaultNotesheetData('PHYS 240 Final Exam');
assert(defaultData.pages.length === 2, `Default has 2 pages (got ${defaultData.pages.length})`);
assert(defaultData.pages[0].id === 'front', 'Page 1 is front');
assert(defaultData.pages[1].id === 'back', 'Page 2 is back');

const serialized = store.serialize(defaultData);
assert(serialized.includes('notesheet: true'), 'Frontmatter contains notesheet: true');
assert(serialized.includes('```notesheet-data'), 'Contains codeblock');

const deserialized = store.deserialize(serialized);
assert(deserialized.title === 'PHYS 240 Final Exam', `Deserialized title matches: ${deserialized.title}`);
assert(deserialized.pages.length === 2, 'Deserialized has 2 pages (front & back)');

// Test 6: Categories Feature
console.log('\nTest Suite 6: Categories and Color Assignment');
assert(defaultData.categories && defaultData.categories.length >= 5, `Has default category presets (count: ${defaultData.categories.length})`);
assert(defaultData.settings.showCategoryTitles === true, 'Category titles enabled by default');

const formulaCat = defaultData.categories.find(c => c.name === 'Formulas');
assert(!!formulaCat, `Found "Formulas" category with color ${formulaCat?.color}`);

// Assign category to an item
defaultData.pages[0].items.push({
  id: 'item-cat-test',
  sourceFile: 'PHYS240/Lecture.md',
  blockId: 'ns-newton2',
  title: 'Newton Second Law',
  content: 'F = ma',
  column: 0,
  order: 1,
  categoryId: formulaCat.id,
  updatedAt: Date.now()
});

const catSerialized = store.serialize(defaultData);
const catDeserialized = store.deserialize(catSerialized);
const testItem = catDeserialized.pages[0].items.find(i => i.id === 'item-cat-test');

assert(testItem?.categoryId === formulaCat.id, `Card retained assigned categoryId: ${testItem?.categoryId}`);
assert(catDeserialized.categories.some(c => c.id === formulaCat.id), 'Categories preserved through serialization');

// Test 7: LR to TD Adjacency Deduplication (Highest Left Title Wins)
console.log('\nTest Suite 7: Adjacency Deduplication (Highest Left Title Wins)');

function checkAdjacency(itemsByCol, c, r) {
  const item = itemsByCol[c][r];
  let hideCategoryBanner = false;
  if (item.categoryId) {
    if (r > 0 && itemsByCol[c][r - 1].categoryId === item.categoryId) {
      hideCategoryBanner = true;
    } else if (c > 0 && r < itemsByCol[c - 1].length && itemsByCol[c - 1][r].categoryId === item.categoryId) {
      hideCategoryBanner = true;
    }
  }
  return { hideCategoryBanner };
}

const gridTest = [
  // Col 0
  [
    { id: 'c0_r0', categoryId: 'cat-theorems', title: 'Nullptrs' },
    { id: 'c0_r1', categoryId: 'cat-theorems', title: 'Upcasting' },
    { id: 'c0_r2', categoryId: 'cat-formulas', title: 'Calculus' }
  ],
  // Col 1
  [
    { id: 'c1_r0', categoryId: 'cat-theorems', title: 'Proof' },
    { id: 'c1_r1', categoryId: 'cat-formulas', title: 'Kinematics' }
  ]
];

// Col 0, Row 0: Top-left, must show title
assert(checkAdjacency(gridTest, 0, 0).hideCategoryBanner === false, 'Col 0, Row 0 shows category title (Highest Left)');

// Col 0, Row 1: Directly below Col 0, Row 0 with same category -> must hide title
assert(checkAdjacency(gridTest, 0, 1).hideCategoryBanner === true, 'Col 0, Row 1 hides title (adjacent TD)');

// Col 0, Row 2: Different category (Formulas) -> must show title
assert(checkAdjacency(gridTest, 0, 2).hideCategoryBanner === false, 'Col 0, Row 2 shows title (new category)');

// Col 1, Row 0: Same category as Col 0, Row 0 (LR adjacent) -> Col 0 wins, Col 1 hides title
assert(checkAdjacency(gridTest, 1, 0).hideCategoryBanner === true, 'Col 1, Row 0 hides title (adjacent LR to Col 0)');

// Col 1, Row 1: Formulas, left is Theorems, above is Theorems -> must show title
assert(checkAdjacency(gridTest, 1, 1).hideCategoryBanner === false, 'Col 1, Row 1 shows title (different category from neighbors)');

console.log(`\n========================================`);
console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
