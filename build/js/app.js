(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory('movieIdCache');
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB(movieItem) {
		$http.put(DB_ENDPOINT + movieItem.id, movieItem).then(function (res) {
			log.debug('api', 'PUT:', res);
		}, function (err) {
			log.debug('err', 'PUT:', err);
		});
	}

	function searchIdFromDB(id) {
		var promise = $http.get(DB_ENDPOINT + id).then(function (res) {
			log.debug('api', 'searchById => DB:', res.data);
			if (res.data) {
				movieIdCache.put(res.data.id, res.data);
				return res.data;
			} else {
				return null;
			}
		}, function (err) {
			log.debug('err', 'searchById => DB:', err);
		});
		return promise;
	}

	function searchIdFromAPI(id) {
		var promise = $http.get(TMDB_API.url + 'movie/' + id, {
			params: { api_key: TMDB_API.key }
		}).then(function (res) {
			log.debug('api', 'searchById => API:', res.data);
			movieIdCache.put(res.data.id, res.data);
			putItemToDB(res.data);
			return res.data;
		}, function (err) {
			log.debug('err', 'searchById => API:', err);
		});
		return promise;
	}

	function searchById(id) {

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('api', 'searchById => cache:', cachedItem);
			df_Res.resolve(cachedItem);
			return df_Res.promise;
		}

		searchIdFromDB(id).then(function (res) {
			if (res) {
				df_DB.resolve(res);
			} else {
				df_DB.reject('not found');
			}
		}, function (err) {
			df_DB.reject(err);
		});

		df_DB.promise.then(function (res_DB) {
			df_Res.resolve(res_DB);
		}, function (err) {
			searchIdFromAPI(id).then(function (res_api) {
				df_Res.resolve(res_api);
			}, function (err_api) {
				df_Res.reject(err_api);
			});
		});

		return df_Res.promise;
	}

	function searchByTitle(searchObj) {

		if (currPage > totalPages && totalPages !== -1) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http.get(TMDB_API.url + 'search/movie', {
			cache: true,
			params: {
				api_key: TMDB_API.key,
				query: searchObj.query,
				page: currPage
			}
		}).then(function (res) {
			// emit event search success
			searchResult = searchResult.concat(removeNoPosterItems(res.data.results));
			totalPages = res.data.total_pages;
			currPage++;
			log.debug('api', 'searchByTitle:', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					log.debug('api', item.id, item);
					movieIdCache.put(item.id, item);
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('err', 'searchByTitle:', err);
		});
	}

	function removeNoPosterItems(results) {
		return results.filter(function (item) {
			return !!item.poster_path;
		});
	}

	function getRes() {
		return searchResult;
	}

	function clearSearch() {
		// emit event clearSeach
		searchResult.length = 0;
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
		putItemToDB: putItemToDB,
		movieIdCache: movieIdCache
	};
}];

},{}],2:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', 'authToken', function (log, ENDPOINT_URI, $http, $q, authToken) {

		var identity = null;
		var _identityResolved = false;

		function authorize(force) {

				var deferred = $q.defer();

				if (force) identity = null;

				if (identity !== null) {

						deferred.resolve(true);
				} else {

						$http.get(ENDPOINT_URI + 'auth', { requireAuth: true }).then(function (res) {

								log.debug('auth', 'auth.authorize():', res, res.data);
								identity = res.data;
								_identityResolved = true;
								deferred.resolve(true);
						}, function (err) {

								log.debug('err', 'authorize', err, err.data);
								// todo if jwt expired , deauthorize, remove local storage, redirect
								_identityResolved = true;
								deferred.reject(err);
						});
				}

				return deferred.promise;
		}

		function deauthorize() {
				authToken.removeToken();
				identity = null;
		}

		function isAuthenticated() {
				return identity !== null;
		}

		function identityResolved() {
				return _identityResolved;
		}

		return {

				authorize: authorize,
				deauthorize: deauthorize,
				isAuthenticated: isAuthenticated,
				identityResolved: identityResolved

		};
}];

},{}],3:[function(require,module,exports){
'use strict';

module.exports = ['authToken', function (authToken) {

	function request(config) {

		if (config.requireAuth) {
			var token = authToken.getToken();
			if (token) {
				// http://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html   section 2.1
				// https://developers.google.com/gmail/markup/actions/verifying-bearer-tokens
				// http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html section 4.2 header field name case insensitive
				config.headers.Authorization = 'Bearer ' + token;
			}
		}

		return config;
	}

	function response(res) {
		return res;
	}

	return {

		request: request,
		response: response

	};
}];

},{}],4:[function(require,module,exports){
'use strict';

module.exports = ['log', '$window', function (log, $window) {

	var storage = $window.localStorage;
	var cachedToken = null;

	function setToken(token) {
		cachedToken = token;
		storage.setItem('jwt', token);
	}

	function getToken() {
		if (!cachedToken) {
			cachedToken = storage.getItem('jwt');
		}
		return cachedToken;
	}

	function removeToken() {
		cachedToken = null;
		storage.removeItem('jwt');
		log.debug('auth', 'token removed');
	}

	function hasToken() {
		return !!getToken();
	}

	return {

		setToken: setToken,
		getToken: getToken,
		removeToken: removeToken,
		hasToken: hasToken

	};
}];

},{}],5:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			log.debug('auth', 'email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			log.debug('auth', 'signin', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('err', 'signin', err);
		});
	};
}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', 'movieCollection', function ($state, auth, movieCollection) {

	auth.deauthorize();
	movieCollection._clear();
	$state.go('signin');
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

					var vm = this;
					vm.user = {};

					vm.signup = function () {

										if (vm.user.email === undefined || vm.user.password === undefined) {
															log.debug('warn', 'email & password required.');
															return;
										}

										log.debug('auth', 'signing up...');
										$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

															log.debug('auth', 'Registered.', res);

															authToken.setToken(res.data.token);
															$state.go('collection');
										}, function (err) {

															log.debug('err', err);
															vm.form.$submitted = false;
										});
					};
}];

},{}],8:[function(require,module,exports){
'use strict';

module.exports = ['$rootScope', function ($rootScope) {

	var EVT = {

		EOP: {
			listen: function listen(cb) {
				$rootScope.$on('EOP', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('EOP');
			}
		},
		collectionModalOpen: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalOpen', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalOpen');
			}
		},
		collectionModalClose: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalClose', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalClose');
			}
		},
		helixNeedsReset: {
			listen: function listen(cb) {
				$rootScope.$on('helixNeedsReset', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('helixNeedsReset');
			}
		}

	};

	return EVT;
}];

},{}],9:[function(require,module,exports){
'use strict';

module.exports = [function () {

	var debugEnabled = false;
	var debugNamespaces = [];

	this.enableDebug = function () {
		debugEnabled = true;
	};

	this.enableDebugNamespace = function () {
		for (var i = 0; i < arguments.length; i++) {
			debugNamespaces.push(arguments[i]);
		}
	};

	this.$get = function () {

		function debug() {
			if (!debugEnabled) return;
			var debugName = arguments[0];
			var slicedArgs = Array.prototype.slice.call(arguments, 1);
			if (debugName === 'err') {
				console.error.apply(console, slicedArgs);
			} else if (debugName === 'info') {
				console.info.apply(console, slicedArgs);
			} else if (debugName === 'warn') {
				console.warn.apply(console, slicedArgs);
			} else if (debugNamespaces.indexOf(debugName) !== -1) {
				console.log.apply(console, [debugName].concat(slicedArgs));
			}
		}

		return {
			debug: debug
		};
	};
}];

},{}],10:[function(require,module,exports){
"use strict";

module.exports = [function () {

	function debounce(func, wait, immediate) {
		var _this = this,
		    _arguments = arguments;

		var timeout;
		return function () {

			var context = _this,
			    args = _arguments;
			var later = function later() {

				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	}

	return {
		debounce: debounce
	};
}];

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$httpProvider', function ($httpProvider) {
	$httpProvider.interceptors.push('authInterceptor');
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	// logProvider.enableDebugNamespace( 'info', 'err', 'auth', 'api', 'collection' );
	logProvider.enableDebugNamespace('info', 'err');

	$httpProvider.useLegacyPromiseExtensions(false);
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('helix', {
		url: '/',
		templateUrl: './template/helix.html'
	}).state('signup', {
		url: '/signup',
		templateUrl: './template/signup.html',
		controller: 'signupCtrl',
		controllerAs: 'signup'
	}).state('signin', {
		url: '/signin',
		templateUrl: './template/signin.html',
		controller: 'signinCtrl',
		controllerAs: 'signin'
	}).state('signout', {
		url: '/signout',
		controller: 'signoutCtrl'
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movieDetail.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
	}).state('collection', {
		url: '/collection',
		templateUrl: './template/collection.html',
		controller: 'movieCollectionCtrl',
		controllerAs: 'mc',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}],
			resolvedCollection: ['movieCollection', function (movieCollection) {
				return movieCollection.resolveCollection();
			}]
		}
	}).state('collectionSettings', {
		url: '/collection/settings/:collectionName',
		templateUrl: './template/collectionSettings.html',
		controller: 'collectionSettings',
		controllerAs: 'mcs'
	});
}];

},{}],14:[function(require,module,exports){
'use strict';

module.exports = [function () {

	function link($scope, $element, $attrs) {

		$element.on('mouseenter', function () {
			$element.removeClass($attrs.leave);
			$element.addClass($attrs.hover);
		}).on('mouseleave', function () {
			$element.removeClass($attrs.hover);
			$element.addClass($attrs.leave);
		});
	}

	return {
		restrict: 'A',
		link: link
	};
}];

},{}],15:[function(require,module,exports){
'use strict';

module.exports = ['$window', 'ENGINE', 'util', function ($window, ENGINE, util) {

	function ctrl($scope, $element) {

		ENGINE.attachRenderer($element);
		$($window).on('resize', util.debounce(ENGINE.onWindowResize, 100));
		$element.on('wheel', function (evt) {
			ENGINE.$$.wheel_dy = -Math.sign(evt.originalEvent.deltaY);
		});

		ENGINE.start();
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div id="canvas-container"></div>'
	};
}];

},{}],16:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $(window).width(),
		height: $(window).height(),
		camera: new THREE.PerspectiveCamera(70, this.width / this.height, 10, 100000),
		renderer: new THREE.CSS3DRenderer(),
		screen_ratio: this.width / this.height,
		pixel_ratio: $window.devicePixelRatio || 1,
		mouse_x: this.width * 0.5,
		mouse_y: this.height * 0.5,
		wheel_dy: 0
	};

	$$.renderer.setSize($$.width, $$.height);

	function attachRenderer(canvas) {
		$$.canvas = canvas;
		canvas.append($$.renderer.domElement);
		canvas.append($$.stats.domElement);
	}

	function onWindowResize() {
		$$.width = $(window).width();
		$$.height = $(window).height();
		$$.pixel_ratio = $window.devicePixelRatio || 1;
		$$.screen_ratio = $$.width / $$.height;
		$$.camera.aspect = $$.screen_ratio;
		$$.camera.updateProjectionMatrix();
		$$.renderer.setSize($$.width, $$.height);
	}

	function setup() {}

	function update() {

		if (Math.abs($$.wheel_dy) > 0.001) {
			$$.camera.position.y += $$.wheel_dy * 1.0;
			$$.camera.rotateY($$.wheel_dy * 0.025);
			$$.wheel_dy *= 0.95;
		}
	}

	// ----  draw loop
	function run() {

		requestAnimationFrame(run);
		update();
		$$.renderer.render($$.scene, $$.camera);
		$$.stats.update();
	}

	function start() {
		setup();
		run();
	}

	function resetCamera() {
		$$.camera.position.set(0, 0, 0);
		$$.camera.rotation.set(0, 0, 0);
	}

	return {
		$$: $$,
		attachRenderer: attachRenderer,
		onWindowResize: onWindowResize,
		start: start,
		resetCamera: resetCamera
	};
}];

},{}],17:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENGINE', '$compile', '$rootScope', function (log, ENGINE, $compile, $rootScope) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add(allPosters);

	function makeHelixPosters(posterObjectMulti, offsetStartIdx) {

		var vector = new THREE.Vector3();
		var radius = 900;
		for (var i = 0; i < posterObjectMulti.length; i++) {

			var $isolatedScope = $rootScope.$new(true);
			$isolatedScope.movieItem = posterObjectMulti[i];

			var posterDirectiveElem = $compile('<poster></poster>')($isolatedScope)[0];
			var css3dObj = new THREE.CSS3DObject(posterDirectiveElem);

			// tag alog an isolatedScope to be destroy when dispose an element
			css3dObj.scope = $isolatedScope;

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			css3dObj.position.x = -radius * Math.sin(phi);
			css3dObj.position.y = -(hidx * 8) + 200;
			css3dObj.position.z = radius * Math.cos(phi);

			vector.set(-css3dObj.position.x * 2, css3dObj.position.y, -css3dObj.position.z * 2);

			css3dObj.lookAt(vector);
			allPosters.add(css3dObj);
		}

		log.debug('info', 'curr posters:', allPosters.children.length);
	}

	function clearAll() {
		allPosters.children.forEach(function (poster) {
			poster.disposeElement();
			poster.scope.$destroy();
		});
		allPosters.children.length = 0; // clear items
	}

	return {
		makeHelixPosters: makeHelixPosters,
		clearAll: clearAll
	};
}];

},{}],18:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'collectionModalService', function ($state, collectionModalService) {

	function ctrl($scope, $element) {

		// $scope.movieItem obj is passed thru isolatedScope via compiled directive in helix.fac.js
		var img = new Image();
		var imgUrl = 'http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path;
		img.onload = function () {

			// todo move css into sass, use class instead
			$element.css({
				'width': '150px',
				'height': '230px',
				'background-repeat': 'no-repeat',
				'background-size': '150px 230px',
				'background-image': 'url(' + imgUrl + ')',
				'display': 'none' // required for fadeIn animation
			});
			$element.fadeIn(1500);
		};
		img.src = imgUrl;

		$element.on('click', function (evt) {
			$state.go('movieDetail', { movieId: $scope.movieItem.id });
			collectionModalService.setActiveItem($scope.movieItem);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],19:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./common/log.pv.js')).factory('util', require('./common/util.js')).factory('EVT', require('./common/events.fac.js')).factory('TMDb', require('./API/TMDb.fac.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('display', require('./helix/display.dir.js')).directive('poster', require('./helix/poster.dir.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('movieCollectionCtrl', require('./movieCollection/movieCollection.ctrl.js')).factory('movieCollection', require('./movieCollection/movieCollection.fac.js')).factory('collectionModalService', require('./movieCollection/collectionModalService.fac.js')).directive('collectionModal', require('./movieCollection/collectionModal.dir.js')).directive('collectionItem', require('./movieCollection/collectionItem.dir.js')).controller('collectionSettings', require('./movieCollection/collectionSettings.ctrl.js')).directive('hoverClass', require('./directive/hoverClass.dir.js')).config(require('./config/routeConfig.js')).config(require('./config/logConfig.js')).config(require('./config/httpConfig.js')).run(['log', '$rootScope', '$state', 'auth', 'movieCollection', function (log, $rootScope, $state, auth, movieCollection) {

	auth.authorize(true);

	movieCollection.resolveCollection();

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]);

},{"./API/TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/signin.ctrl.js":5,"./auth/signout.ctrl.js":6,"./auth/signup.ctrl.js":7,"./common/events.fac.js":8,"./common/log.pv.js":9,"./common/util.js":10,"./config/httpConfig.js":11,"./config/logConfig.js":12,"./config/routeConfig.js":13,"./directive/hoverClass.dir.js":14,"./helix/display.dir.js":15,"./helix/engine.fac.js":16,"./helix/helix.fac.js":17,"./helix/poster.dir.js":18,"./main.ctrl.js":20,"./movieCollection/collectionItem.dir.js":21,"./movieCollection/collectionModal.dir.js":22,"./movieCollection/collectionModalService.fac.js":23,"./movieCollection/collectionSettings.ctrl.js":24,"./movieCollection/movieCollection.ctrl.js":25,"./movieCollection/movieCollection.fac.js":26,"./movieDetail.ctrl.js":27}],20:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', '$state', '$rootScope', function (log, $scope, TMDb, EVT, helix, ENGINE, auth, $state, $rootScope) {

	var vm = this;
	vm.auth = auth;
	vm.search = {
		query: ''
	};
	vm.movieItems = null;

	$scope.$watch(TMDb.getRes, function (movItems, oldMovItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(oldMovItems.length), oldMovItems.length);
	}, true);

	var prevQuery = '';
	var helixNeedsReset = false;
	EVT.helixNeedsReset.listen(function () {
		helixNeedsReset = true;
	});

	vm.search = function () {
		if (vm.search.query === '') return;
		if (prevQuery !== vm.search.query || helixNeedsReset) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
			helixNeedsReset = false;
		}
		if ($state.current.name !== 'helix') {
			$state.go('helix');
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;
	vm.STATE = $state;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],21:[function(require,module,exports){
'use strict';

module.exports = ['log', 'TMDb', function (log, TMDb) {

	function ctrl($scope, $attrs, $element) {

		TMDb.searchById(parseInt($scope.movieId)).then(function (res) {

			// log.debug( 'info', 'collectionItemDirective', res );
			var imgUrl = 'http://image.tmdb.org/t/p/w92/' + res.poster_path;
			$element.css({
				'width': '100%',
				'height': '100%',
				'background-repeat': 'no-repeat',
				'background-size': '100% 100%',
				'background-image': 'url(' + imgUrl + ')'
			});
		}, function (err) {
			log.debug('err', 'collectionItemDirective', err);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		scope: { movieId: '@' },
		controller: ctrl,
		controllerAs: 'ci',
		template: '<div></div>'
	};
}];

},{}],22:[function(require,module,exports){
'use strict';

module.exports = ['log', 'movieCollection', 'collectionModalService', 'EVT', function (log, movieCollection, collectionModalService, EVT) {

	function ctrl($scope, $element, $attrs) {

		var vm = this;
		vm.movieCollection = movieCollection;
		vm.collectionModalService = collectionModalService;

		vm.addingNewCollection = false;

		vm.openEditor = function () {
			vm.addingNewCollection = true;
		};

		vm.closeEditor = function () {
			vm.addingNewCollection = false;
		};

		vm.createNewCollection = function () {
			if ($scope.newCollectionName) {
				movieCollection.create($scope.newCollectionName);
				$scope.newCollectionName = '';
				vm.closeEditor();
			}
		};

		vm.addToCollection = function (movieId, collectionName) {
			if (movieCollection.hasItem(movieId, collectionName)) {
				movieCollection.remove(movieId, collectionName);
			} else {
				log.debug('collection', 'addToCollection:', movieId, collectionName);
				var success = movieCollection.push(movieId, collectionName);
				log.debug('collection', 'movieCollection.push', success);
			}
		};

		vm.closeModal = function () {
			vm.addingNewCollection = false;
			$scope.newCollectionName = '';
			collectionModalService.close();
		};

		// default css at directive initialization
		$element.css({ visibility: 'hidden' });

		EVT.collectionModalOpen.listen(function () {
			log.debug('collection', 'collectionModalOpen');
			$element.css({ visibility: 'visible' });
		});

		EVT.collectionModalClose.listen(function () {
			log.debug('collection', 'collectionModalClose');
			$element.css({ visibility: 'hidden' });
		});
	}

	return {

		restrict: 'E',
		scope: {},
		controller: ctrl,
		controllerAs: 'modal',
		replace: true,
		templateUrl: './template/collectionModal.html'

	};
}];

},{}],23:[function(require,module,exports){
'use strict';

module.exports = ['log', 'EVT', 'auth', '$state', function (log, EVT, auth, $state) {

	var activeItem = null;

	function setActiveItem(item) {
		activeItem = item;
	}

	function getActiveItem(item) {
		return activeItem;
	}

	function open() {
		if (auth.isAuthenticated()) {
			EVT.collectionModalOpen.emit();
		} else {
			$state.go('signin');
		}
	}

	function close() {
		EVT.collectionModalClose.emit();
	}

	return {
		setActiveItem: setActiveItem,
		getActiveItem: getActiveItem,
		open: open,
		close: close
	};
}];

},{}],24:[function(require,module,exports){
'use strict';

module.exports = ['$state', '$stateParams', 'movieCollection', function ($state, $stateParams, movieCollection) {

	var vm = this;
	vm.collectionName = $stateParams.collectionName;

	vm.settings = {};

	vm.deleteCollection = function () {
		if (vm.settings.deleteNameConfirm === vm.collectionName) {
			movieCollection.removeCollection(vm.settings.deleteNameConfirm);
			$state.go('collection');
		}
	};

	vm.renameCollection = function () {
		movieCollection.renameCollection(vm.collectionName, vm.settings.newName);
		$state.go('collection');
	};
}];

},{}],25:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'auth', 'movieCollection', 'TMDb', 'helix', 'ENGINE', '$state', 'EVT', function (log, $scope, auth, movieCollection, TMDb, helix, ENGINE, $state, EVT) {

	log.debug('collection', 'collectionCtrl', movieCollection.getCollection());
	var vm = this;
	vm.movieCollection = movieCollection;

	vm.viewCollection = function (collection) {

		log.debug('info', 'viewCollection =>', collection);

		var loadedItems = 0;
		var totalItems = collection.movies.length;
		var allMovies = [];

		collection.movies.forEach(function (movieId) {

			TMDb.searchById(movieId).then(function (res) {
				allMovies.push(res);
			}, function (err) {
				log.debug('err', 'viewCollection =>', err);
			})['finally'](function () {
				if (++loadedItems === totalItems) {

					helix.clearAll();
					ENGINE.resetCamera();
					helix.makeHelixPosters(allMovies, 0);
					$state.go('helix');
					TMDb.clearSearch();
					EVT.helixNeedsReset.emit();
				}
			});
		});
	};

	vm.showCollectionSettings = function (collection) {

		$state.go('collectionSettings', { collectionName: collection.collectionName });
	};
}];

},{}],26:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	var fullCollection = null;

	function create(name) {
		collection.push({ collectionName: name, movies: [] });
		put();
	}

	function isEmpty() {
		return collection.length === 0;
	}

	function resolveCollection() {

		var deferred = $q.defer();

		if (collection !== null) {
			deferred.resolve(collection);
		} else {
			$http.get(DB_ENDPOINT, { requireAuth: true }).then(function (res) {
				log.debug('collection', 'collection.resolveCollection():', res);
				if (res.data) {
					collection = res.data;
				} else {
					collection = [];
				}
				deferred.resolve(true);
			}, function (err) {
				log.debug('err', 'collection.resolveCollection():', err);
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function hasItem(itemId, someCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === someCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						return true;
					}
				}
			}
		}
		return false;
	}

	function put() {
		$http.put(DB_ENDPOINT, collection, { requireAuth: true }).then(function (res) {
			log.debug('collection', 'collection.put():', res);
		}, function (err) {
			log.debug('err', 'collection.put():', err);
		});
	}

	function push(itemId, toCollection) {
		if (hasItem(itemId, toCollection)) {
			return false;
		}
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === toCollection) {
				collection[i].movies.push(itemId);
				put();
				return true;
			}
		}
		return false;
	}

	function remove(itemId, inCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === inCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						var removed = collection[i].movies.splice(k, 1).length;
						put();
						return removed !== 0;
					}
				}
			}
		}
		return false;
	}

	function removeCollection(collectionName) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === collectionName) {
				var removed = collection.splice(i, 1).length;
				put();
				return removed !== 0;
			}
		}
		return false;
	}

	function renameCollection(collectionName, newName) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === collectionName) {
				collection[i].collectionName = newName;
				put();
				return true;
			}
		}
		return false;
	}

	function getCollection() {
		return collection;
	}

	function _clear() {
		collection = null;
		log.debug('collection', 'local collection cleared.');
	}

	return {
		getCollection: getCollection,
		create: create,
		push: push,
		put: put,
		remove: remove,
		removeCollection: removeCollection,
		renameCollection: renameCollection,
		_clear: _clear,
		resolveCollection: resolveCollection,
		hasItem: hasItem,
		isEmpty: isEmpty
	};
}];

},{}],27:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', 'collectionModalService', 'movieCollection', function (log, $scope, TMDb, $cacheFactory, movieItem, collectionModalService, movieCollection) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug('ctrl', 'movieDetail ctrl resolved:', vm.movieItem);

	movieItem.fullTitle = movieItem.title;
	if (movieItem.title !== movieItem.original_title) {
		movieItem.fullTitle = movieItem.title + ' (' + movieItem.original_title + ')';
	}

	if (movieItem.backdrop_path) {
		var imgUrl = 'http://image.tmdb.org/t/p/original' + movieItem.backdrop_path;
		$('.backdrop').css({
			'background-image': 'url(' + imgUrl + ')'
		});
	}

	vm.openCollectionModal = function () {
		collectionModalService.setActiveItem(movieItem);
		collectionModalService.open();
	};
}];

},{}]},{},[19])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL0FQSS9UTURiLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvYXV0aC9hdXRoLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2F1dGgvc2lnbmluLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9hdXRoL3NpZ251cC5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9jb21tb24vZXZlbnRzLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvY29tbW9uL3V0aWwuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2NvbmZpZy9odHRwQ29uZmlnLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9jb25maWcvcm91dGVDb25maWcuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2RpcmVjdGl2ZS9ob3ZlckNsYXNzLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2hlbGl4L2VuZ2luZS5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL2hlbGl4L2hlbGl4LmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvaW5kZXguanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL21haW4uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25JdGVtLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25Nb2RhbC5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25TZXR0aW5ncy5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvaGVsaXgvc3JjL21vdmllQ29sbGVjdGlvbi9tb3ZpZUNvbGxlY3Rpb24uZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2hlbGl4L3NyYy9tb3ZpZURldGFpbC5jdHJsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7QUNBQSxNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUMzRixVQUFXLEdBQUcsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxhQUFhLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRzs7QUFFdkUsS0FBSSxZQUFZLEdBQUcsRUFBRSxDQUFDO0FBQ3RCLEtBQUksVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3BCLEtBQUksUUFBUSxHQUFHLENBQUMsQ0FBQzs7QUFFakIsS0FBSSxZQUFZLEdB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LEdBQUcsQ0FBQztFQUM5RTs7QUFFRCxLQUFLLFNBQVMsQ0FBQyxhQUFhLEVBQUc7QUFDOUIsTUFBSSxNQUFNLEdBQUcsb0NBQW9DLEdBQUcsU0FBUyxDQUFDLGFBQWEsQ0FBQztBQUM1RSxHQUFDLENBQUUsV0FBVyxDQUFFLENBQUMsR0FBRyxDQUFFO0FBQ3JCLHFCQUFrQixFQUFFLE1BQU0sR0FBRyxNQUFNLEdBQUcsR0FBRztHQUN6QyxDQUFFLENBQUM7RUFDSjs7QUFFRCxHQUFFLENBQUMsbUJBQW1CLEdBQUcsWUFBWTtBQUNwQyx3QkFBc0IsQ0FBQyxhQUFhLENBQUUsU0FBUyxDQUFFLENBQUM7QUFDbEQsd0JBQXNCLENBQUMsSUFBSSxFQUFFLENBQUM7RUFDOUIsQ0FBQztDQUVGLENBQUUsQ0FBQyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckaHR0cCcsICdUTURCX0FQSScsICdFVlQnLCAnJGNhY2hlRmFjdG9yeScsICckcScsICdFTkRQT0lOVF9VUkknLFxyXG5mdW5jdGlvbiAoIGxvZywgJGh0dHAsIFRNREJfQVBJLCBFVlQsICRjYWNoZUZhY3RvcnksICRxLCBFTkRQT0lOVF9VUkkgKSB7XHJcblxyXG5cdHZhciBzZWFyY2hSZXN1bHQgPSBbXTtcclxuXHR2YXIgdG90YWxQYWdlcyA9IC0xO1xyXG5cdHZhciBjdXJyUGFnZSA9IDE7XHJcblxyXG5cdHZhciBtb3ZpZUlkQ2FjaGUgPSAkY2FjaGVGYWN0b3J5KCAnbW92aWVJZENhY2hlJyApO1xyXG5cdC8vIFRNREJfQVBJLnVybCArICdtb3ZpZS9ub3dfcGxheWluZydcclxuXHJcblx0dmFyIERCX0VORFBPSU5UID0gRU5EUE9JTlRfVVJJICsgJ21vdmllLyc7XHJcblxyXG5cdGZ1bmN0aW9uIHB1dEl0ZW1Ub0RCKCBtb3ZpZUl0ZW0gKSB7XHJcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5UICsgbW92aWVJdGVtLmlkLCBtb3ZpZUl0ZW0gKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnUFVUOicsIHJlcyApO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdQVVQ6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21EQiggaWQgKSB7XHJcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggREJfRU5EUE9JTlQgKyBpZCApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeUlkID0+IERCOicsIHJlcy5kYXRhICk7XHJcblx0XHRcdGlmICggcmVzLmRhdGEgKSB7XHJcblx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XHJcblx0XHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0XHR9XHJcblx0XHR9LCBmdW5jdGlvbiggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBEQjonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHRcdHJldHVybiBwcm9taXNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tQVBJKCBpZCApIHtcclxuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnbW92aWUvJyArIGlkLCB7XHJcblx0XHRcdHBhcmFtczogeyBhcGlfa2V5OiBUTURCX0FQSS5rZXkgfVxyXG5cdFx0fSApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgcmVzLmRhdGEgKTtcclxuXHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XHJcblx0XHRcdHB1dEl0ZW1Ub0RCKCByZXMuZGF0YSApO1xyXG5cdFx0XHRyZXR1cm4gcmVzLmRhdGE7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdFx0cmV0dXJuIHByb21pc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hCeUlkKCBpZCApIHtcclxuXHJcblx0XHR2YXIgZGZfREIgPSAkcS5kZWZlcigpO1xyXG5cdFx0dmFyIGRmX1JlcyA9ICRxLmRlZmVyKCk7XHJcblxyXG5cdFx0dmFyIGNhY2hlZEl0ZW0gPSBtb3ZpZUlkQ2FjaGUuZ2V0KCBpZCApO1xyXG5cdFx0aWYgKCBjYWNoZWRJdGVtICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBjYWNoZTonLCBjYWNoZWRJdGVtICk7XHJcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCBjYWNoZWRJdGVtICk7XHJcblx0XHRcdHJldHVybiBkZl9SZXMucHJvbWlzZTtcclxuXHRcdH1cclxuXHJcblx0XHRzZWFyY2hJZEZyb21EQiggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0aWYgKCByZXMgKSB7XHJcblx0XHRcdFx0ZGZfREIucmVzb2x2ZSggcmVzICk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0ZGZfREIucmVqZWN0KCAnbm90IGZvdW5kJyApO1xyXG5cdFx0XHR9XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRkZl9EQi5yZWplY3QoIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdGRmX0RCLnByb21pc2UudGhlbiggZnVuY3Rpb24gKCByZXNfREIgKSB7XHJcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfREIgKTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRzZWFyY2hJZEZyb21BUEkoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXNfYXBpICkge1xyXG5cdFx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfYXBpICk7XHJcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyX2FwaSApIHtcclxuXHRcdFx0XHRkZl9SZXMucmVqZWN0KCBlcnJfYXBpICk7XHJcblx0XHRcdH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoQnlUaXRsZSggc2VhcmNoT2JqICkge1xyXG5cclxuXHRcdGlmICggY3VyclBhZ2UgPiB0b3RhbFBhZ2VzICYmIHRvdGFsUGFnZXMgIT09IC0xICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IGVuZCBvZiBwYWdlXHJcblx0XHRcdEVWVC5FT1AuZW1pdCgpO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0JGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnc2VhcmNoL21vdmllJywge1xyXG5cdFx0XHRjYWNoZTogdHJ1ZSxcclxuXHRcdFx0cGFyYW1zOiB7XHJcblx0XHRcdFx0YXBpX2tleTogVE1EQl9BUEkua2V5LFxyXG5cdFx0XHRcdHF1ZXJ5OiBzZWFyY2hPYmoucXVlcnksXHJcblx0XHRcdFx0cGFnZTogY3VyclBhZ2VcclxuXHRcdFx0fVxyXG5cdFx0fSApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIHN1Y2Nlc3NcclxuXHRcdFx0c2VhcmNoUmVzdWx0ID0gc2VhcmNoUmVzdWx0LmNvbmNhdCggcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzLmRhdGEucmVzdWx0cyApICk7XHJcblx0XHRcdHRvdGFsUGFnZXMgPSByZXMuZGF0YS50b3RhbF9wYWdlcztcclxuXHRcdFx0Y3VyclBhZ2UgKys7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeVRpdGxlOicsIHJlcywgcmVzLmRhdGEgKTtcclxuXHJcblx0XHRcdC8vIGNhY2hlXHJcblx0XHRcdHJlcy5kYXRhLnJlc3VsdHMuZm9yRWFjaCggZnVuY3Rpb24gKCBpdGVtICkge1xyXG5cclxuXHRcdFx0XHRpZiAoICFtb3ZpZUlkQ2FjaGUuZ2V0KCBpdGVtLmlkICkgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdhcGknLCBpdGVtLmlkLCBpdGVtICk7XHJcblx0XHRcdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCBpdGVtLmlkLCBpdGVtICk7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0fSApO1xyXG5cclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBlcnJcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5VGl0bGU6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzdWx0cyApIHtcclxuXHRcdHJldHVybiByZXN1bHRzLmZpbHRlciggZnVuY3Rpb24gKCBpdGVtICkge1xyXG5cdFx0XHRyZXR1cm4gISFpdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0UmVzKCkge1xyXG5cdFx0cmV0dXJuIHNlYXJjaFJlc3VsdDtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGNsZWFyU2VhcmNoKCkge1xyXG5cdFx0Ly8gZW1pdCBldmVudCBjbGVhclNlYWNoXHJcblx0XHRzZWFyY2hSZXN1bHQubGVuZ3RoID0gMDtcclxuXHRcdHRvdGFsUGFnZXMgPSAtMTtcclxuXHRcdGN1cnJQYWdlID0gMTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRzZWFyY2hCeVRpdGxlLFxyXG5cdFx0c2VhcmNoQnlJZCxcclxuXHRcdGNsZWFyU2VhcmNoLFxyXG5cdFx0Z2V0UmVzLFxyXG5cdFx0cHV0SXRlbVRvREIsXHJcblx0XHRtb3ZpZUlkQ2FjaGVcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCAnYXV0aFRva2VuJyxcclxuZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxLCBhdXRoVG9rZW4gKSB7XHJcblxyXG5cdFx0dmFyIGlkZW50aXR5ID0gbnVsbDtcclxuXHRcdHZhciBfaWRlbnRpdHlSZXNvbHZlZCA9IGZhbHNlO1xyXG5cclxuXHRcdGZ1bmN0aW9uIGF1dGhvcml6ZSggZm9yY2UgKSB7XHJcblxyXG5cdFx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdFx0aWYgKCBmb3JjZSApIGlkZW50aXR5ID0gbnVsbDtcclxuXHJcblx0XHRcdGlmICggaWRlbnRpdHkgIT09IG51bGwgKSB7XHJcblxyXG5cdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcclxuXHJcblx0XHRcdH0gZWxzZSB7XHJcblxyXG5cdFx0XHRcdCRodHRwLmdldCggRU5EUE9JTlRfVVJJICsgJ2F1dGgnLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxyXG5cdFx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cclxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdhdXRoLmF1dGhvcml6ZSgpOicsIHJlcywgcmVzLmRhdGEgKTtcclxuXHRcdFx0XHRcdFx0aWRlbnRpdHkgPSByZXMuZGF0YTtcclxuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xyXG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XHJcblxyXG5cdFx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblxyXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnYXV0aG9yaXplJywgZXJyLCBlcnIuZGF0YSApO1xyXG5cdFx0XHRcdFx0XHQvLyB0b2RvIGlmIGp3dCBleHBpcmVkICwgZGVhdXRob3JpemUsIHJlbW92ZSBsb2NhbCBzdG9yYWdlLCByZWRpcmVjdFxyXG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XHJcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XHJcblxyXG5cdFx0XHRcdFx0fSApO1xyXG5cclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XHJcblxyXG5cdFx0fVxyXG5cclxuXHRcdGZ1bmN0aW9uIGRlYXV0aG9yaXplKCkge1xyXG5cdFx0XHRhdXRoVG9rZW4ucmVtb3ZlVG9rZW4oKTtcclxuXHRcdFx0aWRlbnRpdHkgPSBudWxsO1xyXG5cdFx0fVxyXG5cclxuXHRcdGZ1bmN0aW9uIGlzQXV0aGVudGljYXRlZCgpIHtcclxuXHRcdFx0cmV0dXJuIGlkZW50aXR5ICE9PSBudWxsO1xyXG5cdFx0fVxyXG5cclxuXHRcdGZ1bmN0aW9uIGlkZW50aXR5UmVzb2x2ZWQoKSB7XHJcblx0XHRcdHJldHVybiBfaWRlbnRpdHlSZXNvbHZlZDtcclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4ge1xyXG5cclxuXHRcdFx0YXV0aG9yaXplLFxyXG5cdFx0XHRkZWF1dGhvcml6ZSxcclxuXHRcdFx0aXNBdXRoZW50aWNhdGVkLFxyXG5cdFx0XHRpZGVudGl0eVJlc29sdmVkXHJcblxyXG5cdFx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdhdXRoVG9rZW4nLCBmdW5jdGlvbiAoIGF1dGhUb2tlbiApIHtcclxuXHJcblx0ZnVuY3Rpb24gcmVxdWVzdCggY29uZmlnICkge1xyXG5cclxuXHRcdGlmICggY29uZmlnLnJlcXVpcmVBdXRoICkge1xyXG5cdFx0XHR2YXIgdG9rZW4gPSBhdXRoVG9rZW4uZ2V0VG9rZW4oKTtcclxuXHRcdFx0aWYgKCB0b2tlbiApIHtcclxuXHRcdFx0XHQvLyBodHRwOi8vc2VsZi1pc3N1ZWQuaW5mby9kb2NzL2RyYWZ0LWlldGYtb2F1dGgtdjItYmVhcmVyLmh0bWwgICBzZWN0aW9uIDIuMVxyXG5cdFx0XHRcdC8vIGh0dHBzOi8vZGV2ZWxvcGVycy5nb29nbGUuY29tL2dtYWlsL21hcmt1cC9hY3Rpb25zL3ZlcmlmeWluZy1iZWFyZXItdG9rZW5zXHJcblx0XHRcdFx0Ly8gaHR0cDovL3d3dy53My5vcmcvUHJvdG9jb2xzL3JmYzI2MTYvcmZjMjYxNi1zZWM0Lmh0bWwgc2VjdGlvbiA0LjIgaGVhZGVyIGZpZWxkIG5hbWUgY2FzZSBpbnNlbnNpdGl2ZVxyXG5cdFx0XHRcdGNvbmZpZy5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmVhcmVyICcgKyB0b2tlbjtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiBjb25maWc7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVzcG9uc2UoIHJlcyApIHtcclxuXHRcdHJldHVybiByZXM7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cclxuXHRcdHJlcXVlc3QsXHJcblx0XHRyZXNwb25zZVxyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckd2luZG93JywgZnVuY3Rpb24gKCBsb2csICR3aW5kb3cgKSB7XHJcblxyXG5cdHZhciBzdG9yYWdlID0gJHdpbmRvdy5sb2NhbFN0b3JhZ2U7XHJcblx0dmFyIGNhY2hlZFRva2VuID0gbnVsbDtcclxuXHJcblx0ZnVuY3Rpb24gc2V0VG9rZW4oIHRva2VuICkge1xyXG5cdFx0Y2FjaGVkVG9rZW4gPSB0b2tlbjtcclxuXHRcdHN0b3JhZ2Uuc2V0SXRlbSggJ2p3dCcsIHRva2VuICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBnZXRUb2tlbigpIHtcclxuXHRcdGlmICggIWNhY2hlZFRva2VuICkge1xyXG5cdFx0XHRjYWNoZWRUb2tlbiA9IHN0b3JhZ2UuZ2V0SXRlbSggJ2p3dCcgKTtcclxuXHRcdH1cclxuXHRcdHJldHVybiBjYWNoZWRUb2tlbjtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbW92ZVRva2VuKCkge1xyXG5cdFx0Y2FjaGVkVG9rZW4gPSBudWxsO1xyXG5cdFx0c3RvcmFnZS5yZW1vdmVJdGVtKCAnand0JyApO1xyXG5cdFx0bG9nLmRlYnVnKCAnYXV0aCcsICd0b2tlbiByZW1vdmVkJyApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gaGFzVG9rZW4oKSB7XHJcblx0XHRyZXR1cm4gISFnZXRUb2tlbigpO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHJcblx0XHRzZXRUb2tlbixcclxuXHRcdGdldFRva2VuLFxyXG5cdFx0cmVtb3ZlVG9rZW4sXHJcblx0XHRoYXNUb2tlblxyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApICB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0udXNlciA9IHtcclxuXHRcdGVtYWlsOiAnJyxcclxuXHRcdHBhc3N3b3JkOiAnJ1xyXG5cdH07XHJcblxyXG5cdHZtLnNpZ25pbiA9IGZ1bmN0aW9uKCkge1xyXG5cclxuXHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gJycgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gJycgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnZW1haWwgJiBwYXNzd29yZCByZXF1aXJlZC4nICk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbmluJywgdm0udXNlciApXHJcblx0XHRcdC50aGVuKCBmdW5jdGlvbiggcmVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnc2lnbmluJywgcmVzLCByZXMuZGF0YSApO1xyXG5cdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcclxuXHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiggZXJyLCBzdGF0dXMgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NpZ25pbicsIGVyciApO1xyXG5cdFx0XHR9ICk7XHJcblxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCAkc3RhdGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiApICB7XHJcblxyXG5cdGF1dGguZGVhdXRob3JpemUoKTtcclxuXHRtb3ZpZUNvbGxlY3Rpb24uX2NsZWFyKCk7XHJcblx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApIHtcclxuXHJcblx0XHR2YXIgdm0gPSB0aGlzO1xyXG5cdFx0dm0udXNlciA9IHt9O1xyXG5cclxuXHRcdHZtLnNpZ251cCA9IGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gdW5kZWZpbmVkIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09IHVuZGVmaW5lZCApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xyXG5cdFx0XHRcdHJldHVybjtcclxuXHRcdFx0fVxyXG5cclxuXHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdzaWduaW5nIHVwLi4uJyApO1xyXG5cdFx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbnVwJywgdm0udXNlciApXHJcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cclxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnUmVnaXN0ZXJlZC4nLCByZXMgKTtcclxuXHJcblx0XHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XHJcblx0XHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cclxuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCBlcnIgKTtcclxuXHRcdFx0XHRcdHZtLmZvcm0uJHN1Ym1pdHRlZCA9IGZhbHNlO1xyXG5cclxuXHRcdFx0XHR9ICk7XHJcblxyXG5cdFx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckcm9vdFNjb3BlJywgZnVuY3Rpb24gKCAkcm9vdFNjb3BlICkge1xyXG5cclxuXHR2YXIgRVZUID0ge1xyXG5cclxuXHRcdEVPUDoge1xyXG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnRU9QJywgY2IgKTsgfSxcclxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdFT1AnICk7IH1cclxuXHRcdH0sXHJcblx0XHRjb2xsZWN0aW9uTW9kYWxPcGVuOiB7XHJcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxPcGVuJywgY2IgKTsgfSxcclxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdjb2xsZWN0aW9uTW9kYWxPcGVuJyApOyB9XHJcblx0XHR9LFxyXG5cdFx0Y29sbGVjdGlvbk1vZGFsQ2xvc2U6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJywgY2IgKTsgfSxcclxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdjb2xsZWN0aW9uTW9kYWxDbG9zZScgKTsgfVxyXG5cdFx0fSxcclxuXHRcdGhlbGl4TmVlZHNSZXNldDoge1xyXG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnaGVsaXhOZWVkc1Jlc2V0JywgY2IgKTsgfSxcclxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdoZWxpeE5lZWRzUmVzZXQnICk7IH1cclxuXHRcdH1cclxuXHJcblx0fTtcclxuXHJcblx0cmV0dXJuIEVWVDtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcclxuXHJcblx0dmFyIGRlYnVnRW5hYmxlZCA9IGZhbHNlO1xyXG5cdHZhciBkZWJ1Z05hbWVzcGFjZXMgPSBbXTtcclxuXHJcblx0dGhpcy5lbmFibGVEZWJ1ZyA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdGRlYnVnRW5hYmxlZCA9IHRydWU7XHJcblx0fTtcclxuXHJcblx0dGhpcy5lbmFibGVEZWJ1Z05hbWVzcGFjZSA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdGZvciAoIGxldCBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyApIHtcclxuXHRcdFx0ZGVidWdOYW1lc3BhY2VzLnB1c2goIGFyZ3VtZW50c1sgaSBdICk7XHJcblx0XHR9XHJcblx0fTtcclxuXHJcblx0dGhpcy4kZ2V0ID0gKCkgPT4ge1xyXG5cclxuXHRcdGZ1bmN0aW9uIGRlYnVnKCkge1xyXG5cdFx0XHRpZiAoICFkZWJ1Z0VuYWJsZWQgKSByZXR1cm47XHJcblx0XHRcdHZhciBkZWJ1Z05hbWUgPSBhcmd1bWVudHNbIDAgXTtcclxuXHRcdFx0dmFyIHNsaWNlZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCggYXJndW1lbnRzLCAxICk7XHJcblx0XHRcdGlmICggZGVidWdOYW1lID09PSAnZXJyJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLmVycm9yLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ2luZm8nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuaW5mby5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICd3YXJuJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLndhcm4uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lc3BhY2VzLmluZGV4T2YoIGRlYnVnTmFtZSApICE9PSAtMSApIHtcclxuXHRcdFx0XHRjb25zb2xlLmxvZy5hcHBseSggY29uc29sZSwgWyBkZWJ1Z05hbWUgXS5jb25jYXQoIHNsaWNlZEFyZ3MgKSApO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIHtcclxuXHRcdFx0ZGVidWdcclxuXHRcdH07XHJcblxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGRlYm91bmNlKCBmdW5jLCB3YWl0LCBpbW1lZGlhdGUgKSB7XHJcblx0XHR2YXIgX3RoaXMgPSB0aGlzLFxyXG5cdFx0XHRfYXJndW1lbnRzID0gYXJndW1lbnRzO1xyXG5cclxuXHRcdHZhciB0aW1lb3V0O1xyXG5cdFx0cmV0dXJuIGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHRcdHZhciBjb250ZXh0ID0gX3RoaXMsXHJcblx0XHRcdFx0YXJncyA9IF9hcmd1bWVudHM7XHJcblx0XHRcdHZhciBsYXRlciA9IGZ1bmN0aW9uIGxhdGVyKCkge1xyXG5cclxuXHRcdFx0XHR0aW1lb3V0ID0gbnVsbDtcclxuXHRcdFx0XHRpZiAoICFpbW1lZGlhdGUgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XHJcblx0XHRcdH07XHJcblx0XHRcdHZhciBjYWxsTm93ID0gaW1tZWRpYXRlICYmICF0aW1lb3V0O1xyXG5cdFx0XHRjbGVhclRpbWVvdXQoIHRpbWVvdXQgKTtcclxuXHRcdFx0dGltZW91dCA9IHNldFRpbWVvdXQoIGxhdGVyLCB3YWl0ICk7XHJcblx0XHRcdGlmICggY2FsbE5vdyApIGZ1bmMuYXBwbHkoIGNvbnRleHQsIGFyZ3MgKTtcclxuXHRcdH07XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0ZGVib3VuY2VcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoICRodHRwUHJvdmlkZXIgKSB7XHJcblx0JGh0dHBQcm92aWRlci5pbnRlcmNlcHRvcnMucHVzaCggJ2F1dGhJbnRlcmNlcHRvcicgKTtcclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZ1Byb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoIGxvZ1Byb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xyXG5cclxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1ZygpO1xyXG5cdC8vIGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnTmFtZXNwYWNlKCAnaW5mbycsICdlcnInLCAnYXV0aCcsICdhcGknLCAnY29sbGVjdGlvbicgKTtcclxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJyApO1xyXG5cclxuXHQkaHR0cFByb3ZpZGVyLnVzZUxlZ2FjeVByb21pc2VFeHRlbnNpb25zKCBmYWxzZSApO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZVByb3ZpZGVyJywgJyR1cmxSb3V0ZXJQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJyxcclxuZnVuY3Rpb24gKCAkc3RhdGVQcm92aWRlciwgJHVybFJvdXRlclByb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xyXG5cclxuXHQkdXJsUm91dGVyUHJvdmlkZXIub3RoZXJ3aXNlKCAnLycgKTtcclxuXHJcblx0JHN0YXRlUHJvdmlkZXJcclxuXHRcdC5zdGF0ZSggJ2hlbGl4Jywge1xyXG5cdFx0XHR1cmw6ICcvJyxcclxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2hlbGl4Lmh0bWwnXHJcblx0XHR9IClcclxuXHRcdC5zdGF0ZSggJ3NpZ251cCcsIHtcclxuXHRcdFx0dXJsOiAnL3NpZ251cCcsXHJcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWdudXAuaHRtbCcsXHJcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdudXBDdHJsJyxcclxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbnVwJ1xyXG5cdFx0fSApXHJcblx0XHQuc3RhdGUoICdzaWduaW4nLCB7XHJcblx0XHRcdHVybDogJy9zaWduaW4nLFxyXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbmluLmh0bWwnLFxyXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbmluQ3RybCcsXHJcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ25pbidcclxuXHRcdH0gKVxyXG5cdFx0LnN0YXRlKCAnc2lnbm91dCcsIHtcclxuXHRcdFx0dXJsOiAnL3NpZ25vdXQnLFxyXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbm91dEN0cmwnXHJcblx0XHR9IClcclxuXHRcdC5zdGF0ZSggJ21vdmllRGV0YWlsJywge1xyXG5cdFx0XHR1cmw6ICcvbW92aWUvOm1vdmllSWQnLFxyXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvbW92aWVEZXRhaWwuaHRtbCcsXHJcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZURldGFpbEN0cmwnLFxyXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtZCcsXHJcblx0XHRcdHJlc29sdmU6IHtcclxuXHRcdFx0XHRtb3ZpZUl0ZW06IFsgJyRzdGF0ZVBhcmFtcycsICdUTURiJywgZnVuY3Rpb24gKCAkc3RhdGVQYXJhbXMsIFRNRGIgKSB7XHJcblx0XHRcdFx0XHRyZXR1cm4gVE1EYi5zZWFyY2hCeUlkKCAkc3RhdGVQYXJhbXMubW92aWVJZCApO1xyXG5cdFx0XHRcdH0gXVxyXG5cdFx0XHR9XHJcblx0XHR9IClcclxuXHRcdC5zdGF0ZSggJ2NvbGxlY3Rpb24nLCB7XHJcblx0XHRcdHVybDogJy9jb2xsZWN0aW9uJyxcclxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb24uaHRtbCcsXHJcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZUNvbGxlY3Rpb25DdHJsJyxcclxuXHRcdFx0Y29udHJvbGxlckFzOiAnbWMnLFxyXG5cdFx0XHRyZXNvbHZlOiB7XHJcblx0XHRcdFx0YXV0aG9yaXplOiBbICdhdXRoJywgZnVuY3Rpb24gKCBhdXRoICkge1xyXG5cdFx0XHRcdFx0cmV0dXJuIGF1dGguYXV0aG9yaXplKCk7XHJcblx0XHRcdFx0fSBdLFxyXG5cdFx0XHRcdHJlc29sdmVkQ29sbGVjdGlvbjogWyAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBtb3ZpZUNvbGxlY3Rpb24gKSB7XHJcblx0XHRcdFx0XHRyZXR1cm4gbW92aWVDb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk7XHJcblx0XHRcdFx0fSBdXHJcblx0XHRcdH1cclxuXHRcdH0gKVxyXG5cdFx0LnN0YXRlKCAnY29sbGVjdGlvblNldHRpbmdzJywge1xyXG5cdFx0XHR1cmw6ICcvY29sbGVjdGlvbi9zZXR0aW5ncy86Y29sbGVjdGlvbk5hbWUnLFxyXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvblNldHRpbmdzLmh0bWwnLFxyXG5cdFx0XHRjb250cm9sbGVyOiAnY29sbGVjdGlvblNldHRpbmdzJyxcclxuXHRcdFx0Y29udHJvbGxlckFzOiAnbWNzJ1xyXG5cdFx0fSApXHJcblx0O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xyXG5cclxuXHRmdW5jdGlvbiBsaW5rKCAkc2NvcGUsICRlbGVtZW50LCAkYXR0cnMgKSB7XHJcblxyXG5cdFx0JGVsZW1lbnRcclxuXHRcdC5vbiggJ21vdXNlZW50ZXInLCBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdCRlbGVtZW50LnJlbW92ZUNsYXNzKCAkYXR0cnMubGVhdmUgKTtcclxuXHRcdFx0JGVsZW1lbnQuYWRkQ2xhc3MoICRhdHRycy5ob3ZlciApO1xyXG5cdFx0fSApXHJcblx0XHQub24oICdtb3VzZWxlYXZlJywgZnVuY3Rpb24gKCkge1xyXG5cdFx0XHQkZWxlbWVudC5yZW1vdmVDbGFzcyggJGF0dHJzLmhvdmVyICk7XHJcblx0XHRcdCRlbGVtZW50LmFkZENsYXNzKCAkYXR0cnMubGVhdmUgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0cmVzdHJpY3Q6ICdBJyxcclxuXHRcdGxpbms6IGxpbmtcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCAnRU5HSU5FJywgJ3V0aWwnLCBmdW5jdGlvbiAoICR3aW5kb3csIEVOR0lORSwgdXRpbCApIHtcclxuXHJcblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcclxuXHJcblx0XHRFTkdJTkUuYXR0YWNoUmVuZGVyZXIoICRlbGVtZW50ICk7XHJcblx0XHQkKCAkd2luZG93ICkub24oICdyZXNpemUnLCB1dGlsLmRlYm91bmNlKCBFTkdJTkUub25XaW5kb3dSZXNpemUsIDEwMCApICk7XHJcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XHJcblx0XHRcdEVOR0lORS4kJC53aGVlbF9keSA9IC1NYXRoLnNpZ24oIGV2dC5vcmlnaW5hbEV2ZW50LmRlbHRhWSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdEVOR0lORS5zdGFydCgpO1xyXG5cclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRyZXN0cmljdDogJ0UnLFxyXG5cdFx0cmVwbGFjZTogdHJ1ZSxcclxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXHJcblx0XHR0ZW1wbGF0ZTogJzxkaXYgaWQ9XCJjYW52YXMtY29udGFpbmVyXCI+PC9kaXY+J1xyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHdpbmRvdycsIGZ1bmN0aW9uICggJHdpbmRvdyApIHtcclxuXHJcblx0dmFyICQkID0ge1xyXG5cdFx0Y2FudmFzOiBudWxsLFxyXG5cdFx0c3RhdHM6IG5ldyBTdGF0cygpLFxyXG5cdFx0c2NlbmU6IG5ldyBUSFJFRS5TY2VuZSgpLFxyXG5cdFx0d2lkdGg6ICQod2luZG93KS53aWR0aCgpLFxyXG5cdFx0aGVpZ2h0OiAkKHdpbmRvdykuaGVpZ2h0KCksXHJcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxyXG5cdFx0cmVuZGVyZXI6IG5ldyBUSFJFRS5DU1MzRFJlbmRlcmVyKCksXHJcblx0XHRzY3JlZW5fcmF0aW86IHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCxcclxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcclxuXHRcdG1vdXNlX3g6IHRoaXMud2lkdGggKiAwLjUsXHJcblx0XHRtb3VzZV95OiB0aGlzLmhlaWdodCAqIDAuNSxcclxuXHRcdHdoZWVsX2R5OiAwXHJcblx0fTtcclxuXHJcblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xyXG5cclxuXHRmdW5jdGlvbiBhdHRhY2hSZW5kZXJlciggY2FudmFzICkge1xyXG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xyXG5cdFx0Y2FudmFzLmFwcGVuZCggJCQucmVuZGVyZXIuZG9tRWxlbWVudCApO1xyXG5cdFx0Y2FudmFzLmFwcGVuZCggJCQuc3RhdHMuZG9tRWxlbWVudCApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gb25XaW5kb3dSZXNpemUoKSB7XHJcblx0XHQkJC53aWR0aCA9ICQod2luZG93KS53aWR0aCgpO1xyXG5cdFx0JCQuaGVpZ2h0ID0gJCh3aW5kb3cpLmhlaWdodCgpO1xyXG5cdFx0JCQucGl4ZWxfcmF0aW8gPSAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTtcclxuXHRcdCQkLnNjcmVlbl9yYXRpbyA9ICQkLndpZHRoIC8gJCQuaGVpZ2h0O1xyXG5cdFx0JCQuY2FtZXJhLmFzcGVjdCA9ICQkLnNjcmVlbl9yYXRpbztcclxuXHRcdCQkLmNhbWVyYS51cGRhdGVQcm9qZWN0aW9uTWF0cml4KCk7XHJcblx0XHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiB1cGRhdGUoKSB7XHJcblxyXG5cdFx0aWYgKCBNYXRoLmFicyggJCQud2hlZWxfZHkgKSA+IDAuMDAxICkge1xyXG5cdFx0XHQkJC5jYW1lcmEucG9zaXRpb24ueSArPSAkJC53aGVlbF9keSAqIDEuMDtcclxuXHRcdFx0JCQuY2FtZXJhLnJvdGF0ZVkoICQkLndoZWVsX2R5ICogMC4wMjUgKTtcclxuXHRcdFx0JCQud2hlZWxfZHkgKj0gMC45NTtcclxuXHRcdH1cclxuXHJcblx0fVxyXG5cclxuXHQvLyAtLS0tICBkcmF3IGxvb3BcclxuXHRmdW5jdGlvbiBydW4oKSB7XHJcblxyXG5cdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKCBydW4gKTtcclxuXHRcdHVwZGF0ZSgpO1xyXG5cdFx0JCQucmVuZGVyZXIucmVuZGVyKCAkJC5zY2VuZSwgJCQuY2FtZXJhICk7XHJcblx0XHQkJC5zdGF0cy51cGRhdGUoKTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzdGFydCgpIHtcclxuXHRcdHNldHVwKCk7XHJcblx0XHRydW4oKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlc2V0Q2FtZXJhKCkge1xyXG5cdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnNldCggMCwgMCwgMCApO1xyXG5cdFx0JCQuY2FtZXJhLnJvdGF0aW9uLnNldCggMCwgMCwgMCApO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdCQkLFxyXG5cdFx0YXR0YWNoUmVuZGVyZXIsXHJcblx0XHRvbldpbmRvd1Jlc2l6ZSxcclxuXHRcdHN0YXJ0LFxyXG5cdFx0cmVzZXRDYW1lcmEsXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5HSU5FJywgJyRjb21waWxlJywgJyRyb290U2NvcGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgRU5HSU5FLCAkY29tcGlsZSwgJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIGFsbFBvc3RlcnMgPSBuZXcgVEhSRUUuT2JqZWN0M0QoKTtcclxuXHRFTkdJTkUuJCQuc2NlbmUuYWRkKCBhbGxQb3N0ZXJzICk7XHJcblxyXG5cdGZ1bmN0aW9uIG1ha2VIZWxpeFBvc3RlcnMoIHBvc3Rlck9iamVjdE11bHRpLCBvZmZzZXRTdGFydElkeCApIHtcclxuXHJcblx0XHR2YXIgdmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcclxuXHRcdHZhciByYWRpdXMgPSA5MDA7XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBwb3N0ZXJPYmplY3RNdWx0aS5sZW5ndGg7IGkrKyApIHtcclxuXHJcblx0XHRcdHZhciAkaXNvbGF0ZWRTY29wZSA9ICRyb290U2NvcGUuJG5ldyggdHJ1ZSApO1xyXG5cdFx0XHQkaXNvbGF0ZWRTY29wZS5tb3ZpZUl0ZW0gPSBwb3N0ZXJPYmplY3RNdWx0aVsgaSBdO1xyXG5cclxuXHRcdFx0dmFyIHBvc3RlckRpcmVjdGl2ZUVsZW0gPSAkY29tcGlsZSggJzxwb3N0ZXI+PC9wb3N0ZXI+JyApKCAkaXNvbGF0ZWRTY29wZSApWyAwIF07XHJcblx0XHRcdHZhciBjc3MzZE9iaiA9IG5ldyBUSFJFRS5DU1MzRE9iamVjdCggcG9zdGVyRGlyZWN0aXZlRWxlbSApO1xyXG5cclxuXHRcdFx0Ly8gdGFnIGFsb2cgYW4gaXNvbGF0ZWRTY29wZSB0byBiZSBkZXN0cm95IHdoZW4gZGlzcG9zZSBhbiBlbGVtZW50XHJcblx0XHRcdGNzczNkT2JqLnNjb3BlID0gJGlzb2xhdGVkU2NvcGU7XHJcblxyXG5cdFx0XHR2YXIgaGlkeCA9IGkgKyBvZmZzZXRTdGFydElkeDtcclxuXHRcdFx0dmFyIHBoaSA9IGhpZHggKiAwLjE3NSArIE1hdGguUEk7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnggPSAtIHJhZGl1cyAqIE1hdGguc2luKCBwaGkgKTtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueSA9IC0gKCBoaWR4ICogOCApICsgMjAwO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi56ID0gcmFkaXVzICogTWF0aC5jb3MoIHBoaSApO1xyXG5cclxuXHRcdFx0dmVjdG9yLnNldCggLWNzczNkT2JqLnBvc2l0aW9uLnggKiAyLCBjc3MzZE9iai5wb3NpdGlvbi55LCAtY3NzM2RPYmoucG9zaXRpb24ueiAqIDIgKTtcclxuXHJcblx0XHRcdGNzczNkT2JqLmxvb2tBdCggdmVjdG9yICk7XHJcblx0XHRcdGFsbFBvc3RlcnMuYWRkKCBjc3MzZE9iaiApO1xyXG5cclxuXHRcdH1cclxuXHJcblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2N1cnIgcG9zdGVyczonLCBhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCApO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGNsZWFyQWxsKCkge1xyXG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5mb3JFYWNoKCBmdW5jdGlvbiAoIHBvc3RlciApIHtcclxuXHRcdFx0cG9zdGVyLmRpc3Bvc2VFbGVtZW50KCk7XHJcblx0XHRcdHBvc3Rlci5zY29wZS4kZGVzdHJveSgpO1xyXG5cdFx0fSApO1xyXG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5sZW5ndGggPSAwOyAvLyBjbGVhciBpdGVtc1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdG1ha2VIZWxpeFBvc3RlcnMsXHJcblx0XHRjbGVhckFsbFxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCBmdW5jdGlvbiAoICRzdGF0ZSwgY29sbGVjdGlvbk1vZGFsU2VydmljZSApIHtcclxuXHJcblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcclxuXHJcblx0XHQvLyAkc2NvcGUubW92aWVJdGVtIG9iaiBpcyBwYXNzZWQgdGhydSBpc29sYXRlZFNjb3BlIHZpYSBjb21waWxlZCBkaXJlY3RpdmUgaW4gaGVsaXguZmFjLmpzXHJcblx0XHR2YXIgaW1nID0gbmV3IEltYWdlKCk7XHJcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzE1NC8nICsgJHNjb3BlLm1vdmllSXRlbS5wb3N0ZXJfcGF0aDtcclxuXHRcdGltZy5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHQvLyB0b2RvIG1vdmUgY3NzIGludG8gc2FzcywgdXNlIGNsYXNzIGluc3RlYWRcclxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XHJcblx0XHRcdFx0J3dpZHRoJzogJzE1MHB4JyxcclxuXHRcdFx0XHQnaGVpZ2h0JzogJzIzMHB4JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1zaXplJzogJzE1MHB4IDIzMHB4JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJyxcclxuXHRcdFx0XHQnZGlzcGxheSc6ICdub25lJyAvLyByZXF1aXJlZCBmb3IgZmFkZUluIGFuaW1hdGlvblxyXG5cdFx0XHR9ICk7XHJcblx0XHRcdCRlbGVtZW50LmZhZGVJbiggMTUwMCApO1xyXG5cclxuXHRcdH07XHJcblx0XHRpbWcuc3JjID0gaW1nVXJsO1xyXG5cclxuXHRcdCRlbGVtZW50Lm9uKCAnY2xpY2snLCBmdW5jdGlvbiAoIGV2dCApIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnbW92aWVEZXRhaWwnLCB7IG1vdmllSWQ6ICRzY29wZS5tb3ZpZUl0ZW0uaWQgfSApO1xyXG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oICRzY29wZS5tb3ZpZUl0ZW0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0cmVzdHJpY3Q6ICdFJyxcclxuXHRcdHJlcGxhY2U6IHRydWUsXHJcblx0XHRjb250cm9sbGVyOiBjdHJsLFxyXG5cdFx0dGVtcGxhdGU6ICc8ZGl2IGNsYXNzPVwicG9zdGVyRWxlbVwiPjwvZGl2PidcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJhbmd1bGFyLm1vZHVsZSggJ2FwcCcsIFtcclxuXHQndWkucm91dGVyJyxcclxuXHQnbmdBbmltYXRlJ1xyXG5dIClcclxuLmNvbnN0YW50KCAnRU5EUE9JTlRfVVJJJywgJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMS8nIClcclxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XHJcblx0a2V5OiAnMzc0YzAzNDJhNjQwNmRmZTBhZWIzZGUyZWEwNDJjNTknLFxyXG5cdHVybDogJ2h0dHA6Ly9hcGkudGhlbW92aWVkYi5vcmcvMy8nXHJcbn0gKVxyXG5cclxuLnByb3ZpZGVyKCAnbG9nJywgcmVxdWlyZSggJy4vY29tbW9uL2xvZy5wdi5qcycgKSApXHJcbi5mYWN0b3J5KCAndXRpbCcsIHJlcXVpcmUoICcuL2NvbW1vbi91dGlsLmpzJyApIClcclxuLmZhY3RvcnkoICdFVlQnLCByZXF1aXJlKCAnLi9jb21tb24vZXZlbnRzLmZhYy5qcycgKSApXHJcblxyXG4uZmFjdG9yeSggJ1RNRGInLCByZXF1aXJlKCAnLi9BUEkvVE1EYi5mYWMuanMnICkgKVxyXG5cclxuLmNvbnRyb2xsZXIoICdtYWluQ3RybCcsIHJlcXVpcmUoICcuL21haW4uY3RybC5qcycgKSApXHJcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXHJcbi5mYWN0b3J5KCAnaGVsaXgnLCByZXF1aXJlKCAnLi9oZWxpeC9oZWxpeC5mYWMuanMnICkgKVxyXG4uZGlyZWN0aXZlKCAnZGlzcGxheScsIHJlcXVpcmUoICcuL2hlbGl4L2Rpc3BsYXkuZGlyLmpzJyApIClcclxuLmRpcmVjdGl2ZSggJ3Bvc3RlcicsIHJlcXVpcmUoICcuL2hlbGl4L3Bvc3Rlci5kaXIuanMnICkgKVxyXG5cclxuLmNvbnRyb2xsZXIoICdtb3ZpZURldGFpbEN0cmwnLCByZXF1aXJlKCAnLi9tb3ZpZURldGFpbC5jdHJsLmpzJyApIClcclxuXHJcbi5mYWN0b3J5KCAnYXV0aCcsIHJlcXVpcmUoICcuL2F1dGgvYXV0aC5mYWMuanMnICkgKVxyXG4uZmFjdG9yeSggJ2F1dGhUb2tlbicsIHJlcXVpcmUoICcuL2F1dGgvYXV0aFRva2VuLmZhYy5qcycgKSApXHJcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcclxuLmNvbnRyb2xsZXIoICdzaWdudXBDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdudXAuY3RybC5qcycgKSApXHJcbi5jb250cm9sbGVyKCAnc2lnbmluQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbmluLmN0cmwuanMnICkgKVxyXG4uY29udHJvbGxlciggJ3NpZ25vdXRDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdub3V0LmN0cmwuanMnICkgKVxyXG5cclxuLmNvbnRyb2xsZXIoICdtb3ZpZUNvbGxlY3Rpb25DdHJsJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzJyApIClcclxuLmZhY3RvcnkoICdtb3ZpZUNvbGxlY3Rpb24nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmZhYy5qcycgKSApXHJcbi5mYWN0b3J5KCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmZhYy5qcycgKSApXHJcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uTW9kYWwnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsLmRpci5qcycgKSApXHJcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uSXRlbScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uSXRlbS5kaXIuanMnICkgKVxyXG4uY29udHJvbGxlciggJ2NvbGxlY3Rpb25TZXR0aW5ncycsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uU2V0dGluZ3MuY3RybC5qcycgKSApXHJcblxyXG4uZGlyZWN0aXZlKCAnaG92ZXJDbGFzcycsIHJlcXVpcmUoICcuL2RpcmVjdGl2ZS9ob3ZlckNsYXNzLmRpci5qcycgKSApXHJcblxyXG4uY29uZmlnKCByZXF1aXJlKCAnLi9jb25maWcvcm91dGVDb25maWcuanMnICkgKVxyXG4uY29uZmlnKCByZXF1aXJlKCAnLi9jb25maWcvbG9nQ29uZmlnLmpzJyApIClcclxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL2h0dHBDb25maWcuanMnICkgKVxyXG4ucnVuKCBbICdsb2cnLCAnJHJvb3RTY29wZScsICckc3RhdGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIGxvZywgJHJvb3RTY29wZSwgJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSB7XHJcblxyXG5cdGF1dGguYXV0aG9yaXplKCB0cnVlICk7XHJcblxyXG5cdG1vdmllQ29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpO1xyXG5cclxuXHQkcm9vdFNjb3BlLiRvbiggJyRzdGF0ZUNoYW5nZUVycm9yJywgZnVuY3Rpb24gKCBldmVudCwgdG9TdGF0ZSwgdG9QYXJhbXMsIGZyb21TdGF0ZSwgZnJvbVBhcmFtcywgZXJyb3IgKSB7XHJcblxyXG5cdFx0ZXZlbnQucHJldmVudERlZmF1bHQoKTsgLy8gcHJldmVudCB0cmFuc2l0aW9uXHJcblx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyb3IgKTtcclxuXHRcdGlmICggZXJyb3IgKSB7XHJcblx0XHRcdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcclxuXHRcdH1cclxuXHJcblx0fSApO1xyXG5cclxufSBdIClcclxuO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICdFVlQnLCAnaGVsaXgnLCAnRU5HSU5FJywgJ2F1dGgnLCAnJHN0YXRlJywgJyRyb290U2NvcGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBUTURiLCBFVlQsIGhlbGl4LCBFTkdJTkUsIGF1dGgsICRzdGF0ZSwgJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIHZtID0gdGhpcztcclxuXHR2bS5hdXRoID0gYXV0aDtcclxuXHR2bS5zZWFyY2ggPSB7XHJcblx0XHRxdWVyeTogJycsXHJcblx0fTtcclxuXHR2bS5tb3ZpZUl0ZW1zID0gbnVsbDtcclxuXHJcblx0JHNjb3BlLiR3YXRjaCggVE1EYi5nZXRSZXMsIGZ1bmN0aW9uICggbW92SXRlbXMsIG9sZE1vdkl0ZW1zICkge1xyXG5cclxuXHRcdHZtLm1vdmllSXRlbXMgPSBtb3ZJdGVtcztcclxuXHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIG1vdkl0ZW1zLnNsaWNlKCBvbGRNb3ZJdGVtcy5sZW5ndGggKSwgb2xkTW92SXRlbXMubGVuZ3RoICk7XHJcblxyXG5cdH0sIHRydWUgKTtcclxuXHJcblx0dmFyIHByZXZRdWVyeSA9ICcnO1xyXG5cdHZhciBoZWxpeE5lZWRzUmVzZXQgPSBmYWxzZTtcclxuXHRFVlQuaGVsaXhOZWVkc1Jlc2V0Lmxpc3RlbiggZnVuY3Rpb24gKCkge1xyXG5cdFx0aGVsaXhOZWVkc1Jlc2V0ID0gdHJ1ZTtcclxuXHR9ICk7XHJcblxyXG5cdHZtLnNlYXJjaCA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdGlmICggdm0uc2VhcmNoLnF1ZXJ5ID09PSAnJyApIHJldHVybjtcclxuXHRcdGlmICggcHJldlF1ZXJ5ICE9PSB2bS5zZWFyY2gucXVlcnkgfHwgaGVsaXhOZWVkc1Jlc2V0ICkge1xyXG5cdFx0XHRwcmV2UXVlcnkgPSB2bS5zZWFyY2gucXVlcnk7XHJcblx0XHRcdFRNRGIuY2xlYXJTZWFyY2goKTtcclxuXHRcdFx0aGVsaXguY2xlYXJBbGwoKTtcclxuXHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XHJcblx0XHRcdGhlbGl4TmVlZHNSZXNldCA9IGZhbHNlO1xyXG5cdFx0fVxyXG5cdFx0aWYgKCAkc3RhdGUuY3VycmVudC5uYW1lICE9PSAnaGVsaXgnICkge1xyXG5cdFx0XHQkc3RhdGUuZ28oICdoZWxpeCcgKTtcclxuXHRcdH1cclxuXHRcdFRNRGIuc2VhcmNoQnlUaXRsZSggdm0uc2VhcmNoICk7XHJcblx0fTtcclxuXHJcblx0Ly8gREVCVUdcclxuXHR3aW5kb3cuU0NPUEUgPSAkc2NvcGU7XHJcblx0dm0uVE1EYiA9IFRNRGI7XHJcblx0dm0uaGVsaXggPSBoZWxpeDtcclxuXHR2bS5FTkdJTkUgPSBFTkdJTkU7XHJcblx0dm0uU1RBVEUgPSAkc3RhdGU7XHJcblxyXG5cdEVWVC5FT1AubGlzdGVuKCBmdW5jdGlvbiAoKSB7XHJcblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3JlY2lldmVkIEVPUCBldmVudCEnICk7XHJcblx0fSApO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdUTURiJywgZnVuY3Rpb24gKCBsb2csIFRNRGIgKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGF0dHJzLCAkZWxlbWVudCApIHtcclxuXHJcblx0XHRUTURiLnNlYXJjaEJ5SWQoIHBhcnNlSW50KCAkc2NvcGUubW92aWVJZCApIClcclxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHJcblx0XHRcdC8vIGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbkl0ZW1EaXJlY3RpdmUnLCByZXMgKTtcclxuXHRcdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3c5Mi8nICsgcmVzLnBvc3Rlcl9wYXRoO1xyXG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcclxuXHRcdFx0XHQnd2lkdGgnOiAnMTAwJScsXHJcblx0XHRcdFx0J2hlaWdodCc6ICcxMDAlJyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1zaXplJzogJzEwMCUgMTAwJScsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtaW1hZ2UnOiAndXJsKCcgKyBpbWdVcmwgKyAnKSdcclxuXHRcdFx0fSApO1xyXG5cclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbkl0ZW1EaXJlY3RpdmUnLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0cmVzdHJpY3Q6ICdFJyxcclxuXHRcdHJlcGxhY2U6IHRydWUsXHJcblx0XHRzY29wZTogeyBtb3ZpZUlkOiAnQCcgfSxcclxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXHJcblx0XHRjb250cm9sbGVyQXM6ICdjaScsXHJcblx0XHR0ZW1wbGF0ZTogJzxkaXY+PC9kaXY+J1xyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ21vdmllQ29sbGVjdGlvbicsICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgJ0VWVCcsXHJcbmZ1bmN0aW9uICggbG9nLCBtb3ZpZUNvbGxlY3Rpb24sIGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UsIEVWVCApIHtcclxuXHJcblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCwgJGF0dHJzICkge1xyXG5cclxuXHRcdHZhciB2bSA9IHRoaXM7XHJcblx0XHR2bS5tb3ZpZUNvbGxlY3Rpb24gPSBtb3ZpZUNvbGxlY3Rpb247XHJcblx0XHR2bS5jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlID0gY29sbGVjdGlvbk1vZGFsU2VydmljZTtcclxuXHJcblx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gZmFsc2U7XHJcblxyXG5cdFx0dm0ub3BlbkVkaXRvciA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IHRydWU7XHJcblx0XHR9O1xyXG5cclxuXHRcdHZtLmNsb3NlRWRpdG9yID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gZmFsc2U7XHJcblx0XHR9O1xyXG5cclxuXHRcdHZtLmNyZWF0ZU5ld0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdGlmICggJHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lICkge1xyXG5cdFx0XHRcdG1vdmllQ29sbGVjdGlvbi5jcmVhdGUoICRzY29wZS5uZXdDb2xsZWN0aW9uTmFtZSApO1xyXG5cdFx0XHRcdCRzY29wZS5uZXdDb2xsZWN0aW9uTmFtZSA9ICcnO1xyXG5cdFx0XHRcdHZtLmNsb3NlRWRpdG9yKCk7XHJcblx0XHRcdH1cclxuXHRcdH07XHJcblxyXG5cdFx0dm0uYWRkVG9Db2xsZWN0aW9uID0gZnVuY3Rpb24gKCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdFx0aWYgKCBtb3ZpZUNvbGxlY3Rpb24uaGFzSXRlbSggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKSApIHtcclxuXHRcdFx0XHRtb3ZpZUNvbGxlY3Rpb24ucmVtb3ZlKCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnYWRkVG9Db2xsZWN0aW9uOicsIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICk7XHJcblx0XHRcdFx0dmFyIHN1Y2Nlc3MgPSBtb3ZpZUNvbGxlY3Rpb24ucHVzaCggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ21vdmllQ29sbGVjdGlvbi5wdXNoJywgc3VjY2VzcyApO1xyXG5cdFx0XHR9XHJcblx0XHR9O1xyXG5cclxuXHRcdHZtLmNsb3NlTW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSBmYWxzZTtcclxuXHRcdFx0JHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lID0gJyc7XHJcblx0XHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UuY2xvc2UoKTtcclxuXHRcdH07XHJcblxyXG5cdFx0Ly8gZGVmYXVsdCBjc3MgYXQgZGlyZWN0aXZlIGluaXRpYWxpemF0aW9uXHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cclxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxPcGVuLmxpc3RlbiggZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ3Zpc2libGUnIH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UubGlzdGVuKCBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblxyXG5cdFx0cmVzdHJpY3Q6ICdFJyxcclxuXHRcdHNjb3BlOiB7fSxcclxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXHJcblx0XHRjb250cm9sbGVyQXM6ICdtb2RhbCcsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb25Nb2RhbC5odG1sJ1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFVlQnLCAnYXV0aCcsICckc3RhdGUnLCBmdW5jdGlvbiAoIGxvZywgRVZULCBhdXRoLCAkc3RhdGUgKSB7XHJcblxyXG5cdHZhciBhY3RpdmVJdGVtID0gbnVsbDtcclxuXHJcblx0ZnVuY3Rpb24gc2V0QWN0aXZlSXRlbSggaXRlbSApIHtcclxuXHRcdGFjdGl2ZUl0ZW0gPSBpdGVtO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0QWN0aXZlSXRlbSggaXRlbSApIHtcclxuXHRcdHJldHVybiBhY3RpdmVJdGVtO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gb3BlbigpIHtcclxuXHRcdGlmICggYXV0aC5pc0F1dGhlbnRpY2F0ZWQoKSApIHtcclxuXHRcdFx0RVZULmNvbGxlY3Rpb25Nb2RhbE9wZW4uZW1pdCgpO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xyXG5cdFx0fVxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gY2xvc2UoKSB7XHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UuZW1pdCgpO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHNldEFjdGl2ZUl0ZW0sXHJcblx0XHRnZXRBY3RpdmVJdGVtLFxyXG5cdFx0b3BlbixcclxuXHRcdGNsb3NlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnJHN0YXRlUGFyYW1zJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggJHN0YXRlLCAkc3RhdGVQYXJhbXMsIG1vdmllQ29sbGVjdGlvbiApIHtcclxuXHJcblx0dmFyIHZtID0gdGhpcztcclxuXHR2bS5jb2xsZWN0aW9uTmFtZSA9ICRzdGF0ZVBhcmFtcy5jb2xsZWN0aW9uTmFtZTtcclxuXHJcblx0dm0uc2V0dGluZ3MgPSB7fTtcclxuXHJcblx0dm0uZGVsZXRlQ29sbGVjdGlvbiA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdGlmICggdm0uc2V0dGluZ3MuZGVsZXRlTmFtZUNvbmZpcm0gPT09IHZtLmNvbGxlY3Rpb25OYW1lICkge1xyXG5cdFx0XHRtb3ZpZUNvbGxlY3Rpb24ucmVtb3ZlQ29sbGVjdGlvbiggdm0uc2V0dGluZ3MuZGVsZXRlTmFtZUNvbmZpcm0gKTtcclxuXHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcclxuXHRcdH1cclxuXHR9O1xyXG5cclxuXHR2bS5yZW5hbWVDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0bW92aWVDb2xsZWN0aW9uLnJlbmFtZUNvbGxlY3Rpb24oIHZtLmNvbGxlY3Rpb25OYW1lLCB2bS5zZXR0aW5ncy5uZXdOYW1lICk7XHJcblx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cdH1cclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgJ1RNRGInLCAnaGVsaXgnLCAnRU5HSU5FJywgJyRzdGF0ZScsICdFVlQnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24sIFRNRGIsIGhlbGl4LCBFTkdJTkUsICRzdGF0ZSwgRVZUICkgIHtcclxuXHJcblx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uQ3RybCcsIG1vdmllQ29sbGVjdGlvbi5nZXRDb2xsZWN0aW9uKCkgKTtcclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLm1vdmllQ29sbGVjdGlvbiA9IG1vdmllQ29sbGVjdGlvbjtcclxuXHJcblx0dm0udmlld0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoIGNvbGxlY3Rpb24gKSB7XHJcblxyXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICd2aWV3Q29sbGVjdGlvbiA9PicsIGNvbGxlY3Rpb24gKTtcclxuXHJcblx0XHR2YXIgbG9hZGVkSXRlbXMgPSAwO1xyXG5cdFx0dmFyIHRvdGFsSXRlbXMgPSBjb2xsZWN0aW9uLm1vdmllcy5sZW5ndGg7XHJcblx0XHR2YXIgYWxsTW92aWVzID0gW107XHJcblxyXG5cdFx0Y29sbGVjdGlvbi5tb3ZpZXMuZm9yRWFjaCggZnVuY3Rpb24gKCBtb3ZpZUlkICkge1xyXG5cclxuXHRcdFx0VE1EYi5zZWFyY2hCeUlkKCBtb3ZpZUlkIClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0XHRhbGxNb3ZpZXMucHVzaCggcmVzICk7XHJcblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAndmlld0NvbGxlY3Rpb24gPT4nLCBlcnIgKTtcclxuXHRcdFx0XHR9IClcclxuXHRcdFx0XHQuZmluYWxseSggZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRcdFx0aWYgKCArK2xvYWRlZEl0ZW1zID09PSB0b3RhbEl0ZW1zICkge1xyXG5cclxuXHRcdFx0XHRcdFx0aGVsaXguY2xlYXJBbGwoKTtcclxuXHRcdFx0XHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XHJcblx0XHRcdFx0XHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIGFsbE1vdmllcywgMCApO1xyXG5cdFx0XHRcdFx0XHQkc3RhdGUuZ28oICdoZWxpeCcgKTtcclxuXHRcdFx0XHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xyXG5cdFx0XHRcdFx0XHRFVlQuaGVsaXhOZWVkc1Jlc2V0LmVtaXQoKTtcclxuXHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fSApO1xyXG5cclxuXHRcdH0gKTtcclxuXHJcblx0fTtcclxuXHJcblx0dm0uc2hvd0NvbGxlY3Rpb25TZXR0aW5ncyA9IGZ1bmN0aW9uICggY29sbGVjdGlvbiApIHtcclxuXHJcblx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uU2V0dGluZ3MnLCB7IGNvbGxlY3Rpb25OYW1lOiBjb2xsZWN0aW9uLmNvbGxlY3Rpb25OYW1lIH0gKTtcclxuXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxICkge1xyXG5cclxuXHR2YXIgREJfRU5EUE9JTlQgPSBFTkRQT0lOVF9VUkkgKyAnY29sbGVjdGlvbic7XHJcblx0dmFyIGNvbGxlY3Rpb24gPSBudWxsO1xyXG5cclxuXHR2YXIgZnVsbENvbGxlY3Rpb24gPSBudWxsO1xyXG5cclxuXHRmdW5jdGlvbiBjcmVhdGUoIG5hbWUgKSB7XHJcblx0XHRjb2xsZWN0aW9uLnB1c2goIHsgY29sbGVjdGlvbk5hbWU6IG5hbWUsIG1vdmllczogW10gfSApO1xyXG5cdFx0cHV0KCk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBpc0VtcHR5KCkge1xyXG5cdFx0cmV0dXJuIGNvbGxlY3Rpb24ubGVuZ3RoID09PSAwO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVzb2x2ZUNvbGxlY3Rpb24oKSB7XHJcblxyXG5cdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcclxuXHJcblx0XHRpZiAoIGNvbGxlY3Rpb24gIT09IG51bGwgKSB7XHJcblx0XHRcdGRlZmVycmVkLnJlc29sdmUoIGNvbGxlY3Rpb24gKTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdCRodHRwLmdldCggREJfRU5EUE9JTlQsIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXHJcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk6JywgcmVzICk7XHJcblx0XHRcdFx0XHRpZiAoIHJlcy5kYXRhICkge1xyXG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gcmVzLmRhdGE7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gW107XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XHJcblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIGVyciApO1xyXG5cdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcclxuXHRcdFx0XHR9ICk7XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gaGFzSXRlbSggaXRlbUlkLCBzb21lQ29sbGVjdGlvbiApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHNvbWVDb2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcclxuXHRcdFx0XHRcdGlmICggY29sbGVjdGlvbltpXS5tb3ZpZXNba10gPT09IGl0ZW1JZCApIHtcclxuXHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBwdXQoKSB7XHJcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5ULCBjb2xsZWN0aW9uLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxyXG5cdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uLnB1dCgpOicsIHJlcyApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5wdXQoKTonLCBlcnIgKTtcclxuXHRcdFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcHVzaCggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSB7XHJcblx0XHRpZiAoIGhhc0l0ZW0oIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkgKSB7XHJcblx0XHRcdHJldHVybiBmYWxzZTtcclxuXHRcdH1cclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHRvQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRjb2xsZWN0aW9uW2ldLm1vdmllcy5wdXNoKCBpdGVtSWQgKTtcclxuXHRcdFx0XHRwdXQoKTtcclxuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVtb3ZlKCBpdGVtSWQsIGluQ29sbGVjdGlvbiApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGluQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRmb3IgKCB2YXIgayA9IDA7IGsgPCBjb2xsZWN0aW9uW2ldLm1vdmllcy5sZW5ndGg7IGsgKysgKSB7XHJcblx0XHRcdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0ubW92aWVzW2tdID09PSBpdGVtSWQgKSB7XHJcblx0XHRcdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbltpXS5tb3ZpZXMuc3BsaWNlKCBrLCAxICkubGVuZ3RoO1xyXG5cdFx0XHRcdFx0XHRwdXQoKTtcclxuXHRcdFx0XHRcdFx0cmV0dXJuIHJlbW92ZWQgIT09IDA7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmVDb2xsZWN0aW9uKCBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGNvbGxlY3Rpb25OYW1lICkge1xyXG5cdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbi5zcGxpY2UoIGksIDEgKS5sZW5ndGg7XHJcblx0XHRcdFx0cHV0KCk7XHJcblx0XHRcdFx0cmV0dXJuIHJlbW92ZWQgIT09IDA7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbmFtZUNvbGxlY3Rpb24oIGNvbGxlY3Rpb25OYW1lLCAgbmV3TmFtZSApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGNvbGxlY3Rpb25OYW1lICkge1xyXG5cdFx0XHRcdGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPSBuZXdOYW1lO1xyXG5cdFx0XHRcdHB1dCgpO1xyXG5cdFx0XHRcdHJldHVybiB0cnVlO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBnZXRDb2xsZWN0aW9uKCkge1xyXG5cdFx0cmV0dXJuIGNvbGxlY3Rpb247XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBfY2xlYXIoKSB7XHJcblx0XHRjb2xsZWN0aW9uID0gbnVsbDtcclxuXHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnbG9jYWwgY29sbGVjdGlvbiBjbGVhcmVkLicgKTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRnZXRDb2xsZWN0aW9uLFxyXG5cdFx0Y3JlYXRlLFxyXG5cdFx0cHVzaCxcclxuXHRcdHB1dCxcclxuXHRcdHJlbW92ZSxcclxuXHRcdHJlbW92ZUNvbGxlY3Rpb24sXHJcblx0XHRyZW5hbWVDb2xsZWN0aW9uLFxyXG5cdFx0X2NsZWFyLFxyXG5cdFx0cmVzb2x2ZUNvbGxlY3Rpb24sXHJcblx0XHRoYXNJdGVtLFxyXG5cdFx0aXNFbXB0eVxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJyRjYWNoZUZhY3RvcnknLCAnbW92aWVJdGVtJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCAnbW92aWVDb2xsZWN0aW9uJyxcclxuZnVuY3Rpb24oIGxvZywgJHNjb3BlLCBUTURiLCAkY2FjaGVGYWN0b3J5LCBtb3ZpZUl0ZW0sIGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UsIG1vdmllQ29sbGVjdGlvbiApIHtcclxuXHJcblx0dmFyIHZtID0gdGhpcztcclxuXHR2bS5tb3ZpZUl0ZW0gPSBtb3ZpZUl0ZW07IC8vIG1vdmllSXRlbSBpbmplY3RlZCB2aWEgc3RhdGUgcmVzb2x2ZVxyXG5cdGxvZy5kZWJ1ZyggJ2N0cmwnLCAnbW92aWVEZXRhaWwgY3RybCByZXNvbHZlZDonLCB2bS5tb3ZpZUl0ZW0gKTtcclxuXHJcblx0bW92aWVJdGVtLmZ1bGxUaXRsZSA9IG1vdmllSXRlbS50aXRsZTtcclxuXHRpZiAoIG1vdmllSXRlbS50aXRsZSAhPT0gbW92aWVJdGVtLm9yaWdpbmFsX3RpdGxlICkge1xyXG5cdFx0bW92aWVJdGVtLmZ1bGxUaXRsZSA9IG1vdmllSXRlbS50aXRsZSArICcgKCcgKyBtb3ZpZUl0ZW0ub3JpZ2luYWxfdGl0bGUgKyAnKSc7XHJcblx0fVxyXG5cclxuXHRpZiAoIG1vdmllSXRlbS5iYWNrZHJvcF9wYXRoICkge1xyXG5cdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL29yaWdpbmFsJyArIG1vdmllSXRlbS5iYWNrZHJvcF9wYXRoO1xyXG5cdFx0JCggJy5iYWNrZHJvcCcgKS5jc3MoIHtcclxuXHRcdFx0J2JhY2tncm91bmQtaW1hZ2UnOiAndXJsKCcgKyBpbWdVcmwgKyAnKSdcclxuXHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdHZtLm9wZW5Db2xsZWN0aW9uTW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oIG1vdmllSXRlbSApO1xyXG5cdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5vcGVuKCk7XHJcblx0fTtcclxuXHJcbn0gXTtcclxuIl19
