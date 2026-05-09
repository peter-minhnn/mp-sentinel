<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import Button from '$lib/Button.svelte';

  let count = $state(0);

  onMount(() => {
    console.log('mounted');
  });

  function handleClick() {
    count++;
  }
</script>

<main>
  <h1>Hello Svelte!</h1>
  <Button on:click={handleClick}>Clicked {count} times</Button>
</main>
