<script lang="ts">
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import type { Writable } from 'svelte/store';

  export const count: Writable<number> = writable(0);

  onMount(() => {
    count.set(1);
  });
</script>

<!-- Violation: import outside <script> tag -->
import { invalid } from '@sveltejs/kit';

<div>
  <p>Count: {$count}</p>
</div>
