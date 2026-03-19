"use client";

import { useMemo } from "react";
import { Group } from "@visx/group";
import { Tree, hierarchy } from "@visx/hierarchy";
import { LinkHorizontal } from "@visx/shape";
import { useParentSize } from "@visx/responsive";

interface TreeNode {
  name: string;
  count?: number;
  children?: TreeNode[];
}

interface OutreachSequenceTreeProps {
  data: TreeNode;
}

const NODE_WIDTH = 100;
const NODE_HEIGHT = 30;

function TreeNodeComponent({
  node,
}: {
  node: { x: number; y: number; data: TreeNode };
}) {
  const isRoot = !node.data.count && node.data.count !== 0;
  return (
    <Group top={node.x} left={node.y}>
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        x={-NODE_WIDTH / 2}
        y={-NODE_HEIGHT / 2}
        rx={6}
        fill={isRoot ? "hsl(220, 70%, 50%)" : "hsl(220, 40%, 94%)"}
        stroke="hsl(220, 30%, 70%)"
        strokeWidth={1}
      />
      <text
        dy="0.33em"
        fontSize={10}
        fontFamily="system-ui"
        textAnchor="middle"
        fill={isRoot ? "#fff" : "hsl(220, 20%, 30%)"}
        fontWeight={isRoot ? 600 : 400}
      >
        {node.data.name}
      </text>
      {node.data.count !== undefined && (
        <text
          dy="0.33em"
          dx={NODE_WIDTH / 2 + 6}
          fontSize={9}
          fontFamily="system-ui"
          textAnchor="start"
          fill="hsl(220, 15%, 50%)"
        >
          {node.data.count}
        </text>
      )}
    </Group>
  );
}

function TreeChart({
  data,
  width,
  height,
}: {
  data: TreeNode;
  width: number;
  height: number;
}) {
  const root = useMemo(() => {
    const h = hierarchy(data);
    h.sort((a, b) => (a.data.name > b.data.name ? 1 : -1));
    return h;
  }, [data]);

  const margin = { top: 20, left: 80, right: 80, bottom: 20 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  if (innerWidth < 50 || innerHeight < 50) return null;

  return (
    <svg width={width} height={height}>
      <Tree<TreeNode>
        root={root}
        size={[innerHeight, innerWidth]}
      >
        {(tree) => (
          <Group top={margin.top} left={margin.left}>
            {tree.links().map((link, i) => (
              <LinkHorizontal
                key={`link-${i}`}
                data={link}
                stroke="hsl(220, 20%, 75%)"
                strokeWidth={1.5}
                fill="none"
              />
            ))}
            {tree.descendants().map((node, i) => (
              <TreeNodeComponent key={`node-${i}`} node={node} />
            ))}
          </Group>
        )}
      </Tree>
    </svg>
  );
}

export function OutreachSequenceTree({ data }: OutreachSequenceTreeProps) {
  const { parentRef, width, height } = useParentSize({ debounceTime: 150 });

  return (
    <div
      ref={parentRef}
      style={{ width: "100%", height: 320 }}
    >
      {width > 0 && height > 0 && (
        <TreeChart data={data} width={width} height={height} />
      )}
    </div>
  );
}
