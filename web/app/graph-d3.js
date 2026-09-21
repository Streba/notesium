var t = `
<div class="forcegraph h-full w-full overflow-hidden text-gray-200" ref="forcegraph"></div>
`

export default {
  props: [
    'graphData',
    'emphasizeNodeIds',
    'display',
    'forces',
  ],
  emits: ['title-click'],
  data() {
    return {
      zoomTransform: null,
    }
  },
  methods: {
    // Seeds a brand-new node near the average position of its already-placed
    // linked neighbors, so it visibly grows out of its connection instead of
    // spawning at the center (D3's default for nodes without x/y). Falls
    // back to a small jitter around the origin when none of its neighbors
    // are placed yet (e.g. the very first load, or a disconnected cluster).
    seedPosition(nodeId, links, nodesById) {
      const neighborPositions = [];
      for (const link of links) {
        let neighborId = null;
        if (link.source === nodeId) neighborId = link.target;
        else if (link.target === nodeId) neighborId = link.source;
        if (neighborId === null) continue;
        const neighbor = nodesById.get(neighborId);
        if (neighbor) neighborPositions.push(neighbor);
      }
      if (neighborPositions.length > 0) {
        const avgX = neighborPositions.reduce((sum, n) => sum + n.x, 0) / neighborPositions.length;
        const avgY = neighborPositions.reduce((sum, n) => sum + n.y, 0) / neighborPositions.length;
        return { x: avgX + (Math.random() - 0.5) * 10, y: avgY + (Math.random() - 0.5) * 10 };
      }
      return { x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20 };
    },
    // Merges new data into the live simulation: existing nodes keep their
    // physics state (x/y/vx/vy) by object identity, new nodes are seeded
    // near their linked neighbors, removed nodes drop out. Only a fresh
    // mount (isInitial) does a full-energy layout; later updates restart
    // gently so unrelated nodes don't jump around.
    updateGraph(data, isInitial) {
      const vm = this;
      const nodesById = vm.nodesById;

      const incomingIds = new Set(data.nodes.map(n => n.id));
      for (const id of Array.from(nodesById.keys())) {
        if (!incomingIds.has(id)) nodesById.delete(id);
      }

      const degreeById = new Map();
      data.links.forEach(l => {
        degreeById.set(l.source, (degreeById.get(l.source) || 0) + 1);
        degreeById.set(l.target, (degreeById.get(l.target) || 0) + 1);
      });

      data.nodes.forEach(n => {
        const degree = degreeById.get(n.id) || 0;
        const existing = nodesById.get(n.id);
        if (existing) {
          existing.title = n.title;
          existing.isLabel = n.isLabel;
          existing.degree = degree;
        } else {
          const seed = vm.seedPosition(n.id, data.links, nodesById);
          nodesById.set(n.id, { id: n.id, title: n.title, isLabel: n.isLabel, degree, x: seed.x, y: seed.y, vx: 0, vy: 0 });
        }
      });

      const nodes = data.nodes.map(n => nodesById.get(n.id));
      const links = data.links.map(l => ({ source: l.source, target: l.target, key: `${l.source}\u0000${l.target}` }));

      vm.simulation.nodes(nodes);
      vm.simulation.force("link").links(links);

      vm.linkSel = vm.linkGroup.selectAll("line")
        .data(links, d => d.key)
        .join("line");

      vm.nodeSel = vm.nodeGroup.selectAll("circle")
        .data(nodes, d => d.id)
        .join(enter => enter.append("circle").classed("node", true).call(vm.drag(vm.simulation)))
        .classed("node-label", n => n.isLabel);

      vm.titleSel = vm.titleGroup.selectAll("text")
        .data(nodes, d => d.id)
        .join(enter => enter.append("text")
          .classed("title", true)
          .attr("text-anchor", "middle")
          .on("click", function(event, node) { event.stopPropagation(); vm.$emit('title-click', node.id); }))
        .text(d => d.title);

      vm.applyHubEmphasis();
      vm.applyTitleVisibility();
      vm.applyTitleScale();
      vm.applyEmphasis(vm.emphasizeNodeIds);

      vm.simulation.alpha(isInitial ? 1 : 0.4).restart();
    },
    drag(simulation) {
      function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      }
      function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
      }
      function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      }
      return d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended);
    },
    applyTitleScale() {
      const vm = this;
      const k = vm.display.scaleTitles.value ? (vm.zoomTransform ? vm.zoomTransform.k : 1) : 1;
      const titleSize = k > 0.9 ? 5 - k : 0;
      vm.titleSel.transition().style("font-size", titleSize + "px");
    },
    applyTitleVisibility() {
      this.titleSel.classed("hidden", !this.display.showTitles.value);
    },
    // Makes well-linked notes stand out: bigger circles, and pulled toward
    // the center via a per-node forceRadial (small target radius for high
    // degree, large for low degree - hubs settle in the middle, leaves
    // drift to the periphery). Collide radius is scaled to match the drawn
    // circle size so bigger hubs don't overlap their neighbors.
    applyHubEmphasis() {
      const vm = this;
      const baseCollideRadius = vm.forces.collideRadius.value;

      if (!vm.display.emphasizeHubs.value) {
        vm.nodeSel.attr("r", d => { d.radius = 2; return d.radius; });
        vm.simulation.force("collide").radius(baseCollideRadius);
        vm.simulation.force("radial").strength(0);
        return;
      }

      const currentNodes = vm.nodeSel.data();
      const totalNodes = currentNodes.length;
      const maxDegree = Math.max(...currentNodes.map(n => n.degree || 0), 1);

      const minBaseRadius = 1;
      const maxBaseRadius = 5;
      const baseRadius = Math.max(minBaseRadius, Math.min(maxBaseRadius, 5 - totalNodes / 5));

      const minRadiusIncrement = 0.1;
      const maxRadiusIncrement = 0.5;
      const radiusIncrement = Math.max(minRadiusIncrement, Math.min(maxRadiusIncrement, 5 / maxDegree));

      const nodeRadius = d => baseRadius + ((d.degree || 0) * radiusIncrement);
      const maxCenterPull = 60;

      vm.nodeSel.attr("r", d => { d.radius = nodeRadius(d); return d.radius; });
      vm.simulation.force("collide").radius(d => baseCollideRadius + (nodeRadius(d) - 2));
      vm.simulation.force("radial")
        .radius(d => maxCenterPull * (1 - (d.degree || 0) / maxDegree))
        .strength(0.15);
    },
    applyEmphasis(nodeIds) {
      const vm = this;
      if (nodeIds && nodeIds.length > 0) {
        const linkedNodeIds = Array.from(new Set(vm.graphData.links
          .filter(l => nodeIds.includes(l.source) || nodeIds.includes(l.target))
          .flatMap(l => [l.source, l.target])));

        vm.nodeSel.attr("fill-opacity", 0.05);
        vm.titleSel.attr("fill-opacity", 0.15).attr("font-weight", "normal");
        vm.linkSel.attr("stroke", "currentColor").attr("stroke-opacity", 0.15);

        vm.nodeSel.filter(n => linkedNodeIds.includes(n.id)).attr("fill-opacity", 0.3);
        vm.titleSel.filter(t => linkedNodeIds.includes(t.id)).attr("fill-opacity", 1);

        vm.nodeSel.filter(n => nodeIds.includes(n.id)).attr("fill-opacity", 1);
        vm.titleSel.filter(t => nodeIds.includes(t.id)).attr("fill-opacity", 1).attr("font-weight", "bold");
        vm.linkSel.filter(l => nodeIds.includes(l.source.id) || nodeIds.includes(l.target.id)).attr("stroke-opacity", 1);
      } else {
        vm.nodeSel.attr("fill-opacity", 1);
        vm.titleSel.attr("fill-opacity", 1).attr("font-weight", "normal");
        vm.linkSel.attr("stroke", "currentColor").attr("stroke-opacity", 1);
      }
    },
    initGraph() {
      const vm = this;
      vm.$refs.forcegraph.innerHTML = "";
      vm.nodesById = new Map();

      const svg = d3.select(vm.$refs.forcegraph).append("svg")
        .style("height", "inherit")
        .style("width", "inherit")
        .attr("viewBox", [-140, -180, 320, 360]);

      vm.simulation = d3.forceSimulation([])
        .force("link", d3.forceLink([]).id(d => d.id))
        .force("charge", d3.forceManyBody())
        .force("collide", d3.forceCollide())
        .force("center", d3.forceCenter())
        .force("x", d3.forceX())
        .force("y", d3.forceY())
        .force("radial", d3.forceRadial(0, 0, 0).strength(0));

      vm.linkGroup = svg.append("g").classed("link", true).attr("stroke", "currentColor");
      vm.nodeGroup = svg.append("g");
      vm.titleGroup = svg.append("g");

      vm.simulation.on("tick", () => {
        vm.linkSel
          .attr("x1", d => d.source.x)
          .attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x)
          .attr("y2", d => d.target.y);
        vm.nodeSel
          .attr("cx", d => d.x)
          .attr("cy", d => d.y);
        vm.titleSel
          .attr('x', d => d.x)
          .attr('y', d => d.y - (d.radius || 2) - 2);
      });

      const zoom = d3.zoom().scaleExtent([0.3, 3]).on('zoom', function(event) {
        svg.selectAll('g').attr('transform', event.transform);
        vm.zoomTransform = {
          k: event.transform.k,
          x: event.transform.x,
          y: event.transform.y
        }
        if (vm.display.scaleTitles.value) vm.applyTitleScale();
      });
      svg.call(zoom);

      vm.updateGraph(vm.graphData, true);

      vm.$watch('display.scaleTitles.value', () => vm.applyTitleScale());
      vm.$watch('display.showTitles.value', () => vm.applyTitleVisibility());
      vm.$watch('display.emphasizeHubs.value', () => { vm.applyHubEmphasis(); vm.simulation.alpha(0.5).restart(); });
      vm.$watch('emphasizeNodeIds', nodeIds => vm.applyEmphasis(nodeIds));

      vm.$watch('forces.chargeStrength.value', function(value) {
        vm.simulation.force("charge", d3.forceManyBody().strength(value));
        vm.simulation.alpha(1).restart();
      });

      vm.$watch('forces.collideRadius.value', function() {
        vm.applyHubEmphasis();
        vm.simulation.alpha(1).restart();
      });

      vm.$watch('forces.collideStrength.value', function(value) {
        vm.simulation.force("collide").strength(value);
        vm.simulation.alpha(1).restart();
      });

      vm.$watch('graphData', newData => { if (newData) vm.updateGraph(newData, false); });
    },
  },
  mounted() {
    this.initGraph();
  },
  template: t
}
