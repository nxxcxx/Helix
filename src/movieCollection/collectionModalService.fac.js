module.exports = [ 'log', 'EVT', 'auth', '$state', function ( log, EVT, auth, $state ) {

	var activeItem = null;

	function setActiveItem( item ) {
		activeItem = item;
	}

	function getActiveItem( item ) {
		return activeItem;
	}

	function open() {
		if ( auth.isAuthenticated() ) {
			EVT.collectionModalOpen.emit();
		} else {
			$state.go( 'signin' );
		}
	}

	function close() {
		EVT.collectionModalClose.emit();
	}

	return {
		setActiveItem,
		getActiveItem,
		open,
		close
	};

} ];
