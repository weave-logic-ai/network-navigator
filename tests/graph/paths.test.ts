// Tests for path finding

describe('Path Finding', () => {
  describe('BFS path finding', () => {
    it('should find direct path', () => {
      const adj = new Map<string, string[]>();
      adj.set('A', ['B']);
      adj.set('B', ['A', 'C']);
      adj.set('C', ['B']);

      // BFS from A to C
      const visited = new Set<string>(['A']);
      const parent = new Map<string, string>();
      const queue: string[] = ['A'];
      let found = false;

      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node === 'C') {
          found = true;
          break;
        }
        for (const neighbor of adj.get(node) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            parent.set(neighbor, node);
            queue.push(neighbor);
          }
        }
      }

      expect(found).toBe(true);

      // Reconstruct path
      const path: string[] = [];
      let current = 'C';
      while (current !== 'A') {
        path.unshift(current);
        current = parent.get(current)!;
      }
      path.unshift('A');

      expect(path).toEqual(['A', 'B', 'C']);
    });

    it('should return null when no path exists', () => {
      const adj = new Map<string, string[]>();
      adj.set('A', ['B']);
      adj.set('B', ['A']);
      adj.set('C', ['D']);
      adj.set('D', ['C']);

      // BFS from A, C is in disconnected component
      const visited = new Set<string>(['A']);
      const queue: string[] = ['A'];
      let found = false;

      while (queue.length > 0) {
        const node = queue.shift()!;
        if (node === 'C') {
          found = true;
          break;
        }
        for (const neighbor of adj.get(node) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      expect(found).toBe(false);
    });

    it('should respect max depth', () => {
      const adj = new Map<string, string[]>();
      adj.set('A', ['B']);
      adj.set('B', ['A', 'C']);
      adj.set('C', ['B', 'D']);
      adj.set('D', ['C', 'E']);
      adj.set('E', ['D']);

      // BFS from A to E with max depth 2 should not find it
      const maxDepth = 2;
      const visited = new Set<string>(['A']);
      const queue: Array<{ node: string; depth: number }> = [{ node: 'A', depth: 0 }];
      let found = false;

      while (queue.length > 0) {
        const { node, depth } = queue.shift()!;
        if (node === 'E') {
          found = true;
          break;
        }
        if (depth >= maxDepth) continue;
        for (const neighbor of adj.get(node) || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push({ node: neighbor, depth: depth + 1 });
          }
        }
      }

      expect(found).toBe(false);
    });
  });

  describe('reachability', () => {
    it('should find all reachable nodes within hops', () => {
      const adj = new Map<string, Set<string>>();
      adj.set('A', new Set(['B', 'C']));
      adj.set('B', new Set(['A', 'D']));
      adj.set('C', new Set(['A']));
      adj.set('D', new Set(['B']));

      const visited = new Map<string, number>();
      visited.set('A', 0);
      const queue: Array<{ node: string; dist: number }> = [{ node: 'A', dist: 0 }];
      const maxHops = 1;

      while (queue.length > 0) {
        const { node, dist } = queue.shift()!;
        if (dist >= maxHops) continue;
        for (const neighbor of adj.get(node) || new Set()) {
          if (!visited.has(neighbor)) {
            visited.set(neighbor, dist + 1);
            queue.push({ node: neighbor, dist: dist + 1 });
          }
        }
      }

      visited.delete('A');
      expect(visited.size).toBe(2); // B and C at distance 1
      expect(visited.get('B')).toBe(1);
      expect(visited.get('C')).toBe(1);
    });
  });
});
